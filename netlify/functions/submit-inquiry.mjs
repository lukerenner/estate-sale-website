import { createRecord, updateRecord, uploadAttachment, findContactByEmail, createContact, updateContact } from "./lib/airtable.mjs";
import { isOffSite, looksLikeSpam, isRateLimited } from "./lib/spam.mjs";
import { verify as verifyTurnstile, TOKEN_FIELD as TURNSTILE_FIELD } from "./lib/turnstile.mjs";

const PHOTOS_FIELD = "Photos";
// Netlify Functions cap request bodies at 6MB; base64-encoding a file adds
// ~33% overhead, so a single attachment must stay well under that raw.
const MAX_ATTACHMENT_BYTES = 4.3 * 1024 * 1024;
// script.js caps uploads at the same count client-side.
const MAX_ATTACHMENTS = 10;
// The two item-intake forms can't be worked without seeing the piece, so a
// photo is mandatory there (matched by `required` on their file inputs).
const PHOTO_REQUIRED_FORMS = new Set(["appraisal", "consignment"]);
const MAX_FIELD_LENGTH = 10000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CONTACT_NEED_TO_INQUIRY_TYPE = {
  "An appraisal": "Appraisal",
  "An estate": "Estate Sale",
  "Consignment": "Consignment",
  "Something else": "General Inquiry",
};

// "Not sure — help me decide" has no equivalent AppraisalType option in
// Airtable, so it's intentionally left unmapped (field stays blank).
const APPRAISAL_TIER_TO_TYPE = {
  "Free Spot Check": "Free Spot Check",
  "Verbal Evaluation": "Informal / Verbal",
  "Full Written Appraisal": "Written",
};

function splitName(fullName) {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Full intake pages send first_name/last_name; every shorter lead-gen form
// site-wide sends a single "name" field instead — accept either shape.
function nameFieldsFrom(fd) {
  if (fd.get("first_name") !== null || fd.get("last_name") !== null) {
    return { first: fd.get("first_name") || "", last: fd.get("last_name") || "" };
  }
  return splitName(fd.get("name"));
}

function contactInputFor(fd) {
  const name = nameFieldsFrom(fd);
  return { firstName: name.first, lastName: name.last, email: fd.get("email") || "", phone: fd.get("phone") || "" };
}

function fieldsForContact(fd) {
  const name = nameFieldsFrom(fd);
  return {
    "First Name": name.first,
    "Last Name": name.last,
    "E-mail": fd.get("email") || "",
    Phone: fd.get("phone") || "",
    "Inquiry Type": CONTACT_NEED_TO_INQUIRY_TYPE[fd.get("I need help with")] || "General Inquiry",
    "Inquiry Message": fd.get("message") || "",
  };
}

function fieldsForAppraisal(fd) {
  const name = nameFieldsFrom(fd);
  const fields = {
    "First Name": name.first,
    "Last Name": name.last,
    "E-mail": fd.get("email") || "",
    Phone: fd.get("phone") || "",
    "Inquiry Type": "Appraisal",
    "Inquiry Message": fd.get("message") || "",
  };
  const mappedTier = APPRAISAL_TIER_TO_TYPE[fd.get("Appraisal Tier")];
  if (mappedTier) fields.AppraisalType = mappedTier;
  return fields;
}

function fieldsForConsignment(fd) {
  const name = nameFieldsFrom(fd);
  return {
    "First Name": name.first,
    "Last Name": name.last,
    "E-mail": fd.get("email") || "",
    Phone: fd.get("phone") || "",
    "Inquiry Type": "Consignment",
    "Inquiry Message": fd.get("message") || "",
  };
}

// our-services/estate-sales.njk's mini form has no message field, just a
// "Timing" select with no equivalent Airtable field — folded into the
// message so the context isn't silently dropped.
function fieldsForEstateSale(fd) {
  const name = nameFieldsFrom(fd);
  const timing = fd.get("Timing");
  return {
    "First Name": name.first,
    "Last Name": name.last,
    "E-mail": fd.get("email") || "",
    Phone: fd.get("phone") || "",
    "Inquiry Type": "Estate Sale",
    "Inquiry Message": timing ? `Timing: ${timing}` : fd.get("message") || "",
  };
}

// The footer's star-rating review form. No Inquiry Type fits a review, and
// there's no dedicated rating field on Website Inquiries, so both the
// rating and free-text feedback go into Inquiry Message.
function fieldsForReview(fd) {
  const name = nameFieldsFrom(fd);
  const rating = fd.get("rating");
  return {
    "First Name": name.first,
    "Last Name": name.last,
    "E-mail": fd.get("email") || "",
    "Inquiry Type": "General Inquiry",
    "Inquiry Message": (rating ? `Rating: ${rating}/5\n` : "") + (fd.get("message") || ""),
  };
}

const FIELD_BUILDERS = {
  contact: fieldsForContact,
  appraisal: fieldsForAppraisal,
  consignment: fieldsForConsignment,
  "estate-sale": fieldsForEstateSale,
  review: fieldsForReview,
};

// Server-side twin of the browser's `required`/`type="email"` checks — the
// endpoint is public, so a bot (or a no-JS browser on a `novalidate` form)
// can POST anything. Returns an error string, or null when the submission is
// complete enough to be worth a row in Airtable.
function validate(fd, formType) {
  const email = String(fd.get("email") || "").trim();
  if (!EMAIL_PATTERN.test(email)) return "A valid email address is required.";
  for (const [key, value] of fd.entries()) {
    if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) return `The ${key} field is too long.`;
  }
  if (formType === "newsletter") return null;
  const name = nameFieldsFrom(fd);
  if (!String(name.first || "").trim()) return "Your name is required.";
  if ((formType === "appraisal" || formType === "consignment") && !String(fd.get("message") || "").trim()) {
    return "Please tell us a little about your item.";
  }
  const photos = fd.getAll("attachment").filter((f) => f && typeof f === "object" && f.size > 0).length;
  if (photos > MAX_ATTACHMENTS) {
    return `Please attach no more than ${MAX_ATTACHMENTS} photos.`;
  }
  if (PHOTO_REQUIRED_FORMS.has(formType) && photos === 0) {
    return "Please attach at least one photo of the item.";
  }
  return null;
}

// Several forms share one form type (the speaking-engagements page posts as a
// plain "contact"), so the page it came from is the only way the team can
// tell those apart in Airtable. Same-site Referer only.
function sourcePageNote(req) {
  try {
    const referer = new URL(req.headers.get("referer") || "");
    const host = new URL(req.url).host;
    if (referer.host !== host) return "";
    return `\n\n— Sent from ${referer.pathname}`;
  } catch {
    return "";
  }
}

// A browser that submits the form natively (JS failed to load, or a
// `novalidate` form posted without script.js) navigates to this endpoint, so
// answer it with a page rather than raw JSON. fetch() from script.js sends
// Accept: */*, which never matches.
function wantsHtml(req) {
  return (req.headers.get("accept") || "").includes("text/html");
}

function respond(req, status, body) {
  if (wantsHtml(req)) {
    if (status === 200) return new Response(null, { status: 303, headers: { Location: "/thanks.html" } });
    // Escaped: a "field is too long" error echoes a client-supplied field name.
    const message = String(body.error || "Something went wrong.").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Submission problem | Gary Germer &amp; Associates</title><meta name="robots" content="noindex"><p>${message} Please go back and try again, or email <a href="mailto:info@garygermer.com">info@garygermer.com</a> or call <a href="tel:+15032350946">(503) 235-0946</a>.</p>`,
      { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// One Contacts row per email: match first, and only ever fill in blank
// fields on an existing contact — never overwrite what's already on file
// with whatever a repeat submitter happened to type this time. `extra` is
// applied unconditionally (used for the newsletter opt-in checkbox, which
// should always end up true regardless of what else is blank/filled).
async function resolveContact({ firstName, lastName, email, phone }, extra) {
  const existing = email ? await findContactByEmail(email) : null;

  if (existing) {
    const patch = {};
    if (firstName && !existing.fields["First Name"]) patch["First Name"] = firstName;
    if (lastName && !existing.fields["Last Name"]) patch["Last Name"] = lastName;
    if (phone && !existing.fields["Phone Number"]) patch["Phone Number"] = phone;
    Object.assign(patch, extra || {});
    if (Object.keys(patch).length) await updateContact(existing.id, patch);
    return existing.id;
  }

  const fields = {};
  if (firstName) fields["First Name"] = firstName;
  if (lastName) fields["Last Name"] = lastName;
  if (email) fields.Email = email;
  if (phone) fields["Phone Number"] = phone;
  Object.assign(fields, extra || {});
  const created = await createContact(fields);
  return created.id;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let formData;
  try {
    formData = await req.formData();
  } catch {
    return respond(req, 400, { error: "Invalid form submission." });
  }

  // Honeypot: report success without writing anything, so bots don't learn
  // their submission was rejected.
  if (formData.get("_honey")) {
    return respond(req, 200, { ok: true });
  }

  // Turnstile first: a token Cloudflare vouches for means a real browser on
  // a real page of ours, which makes the off-site header check redundant and
  // the content heuristics unnecessarily risky — a genuine customer writing
  // in from abroad shouldn't be dropped for it. So a pass skips straight to
  // validation, and only the honeypot above still applies.
  //
  // "skipped" (no secret configured, no token from a no-JS visitor, or
  // Cloudflare unreachable) falls through to the heuristics in lib/spam.mjs,
  // which is exactly how this endpoint behaved before Turnstile.
  const ip = req.headers.get("x-nf-client-connection-ip") || "";
  const turnstile = await verifyTurnstile(formData.get(TURNSTILE_FIELD), ip);

  // Same treatment as the honeypot for everything below — a silent drop, so
  // a bot can't tune around the thresholds. The reason is logged (Netlify
  // function logs only, never shown to the sender) so a false positive can
  // be spotted rather than vanishing without trace.
  const spamReason =
    turnstile === "fail"
      ? "failed the Turnstile check"
      : turnstile === "pass"
        ? null
        : (isOffSite(req) && "submitted from outside the site") ||
          looksLikeSpam(formData) ||
          (isRateLimited(req) && "too many submissions from one address");
  if (spamReason) {
    console.warn(`Dropped submission (${spamReason}):`, JSON.stringify({
      form: formData.get("form"),
      email: formData.get("email"),
      name: formData.get("name") || `${formData.get("first_name") || ""} ${formData.get("last_name") || ""}`.trim(),
    }));
    return respond(req, 200, { ok: true });
  }

  const formType = formData.get("form");
  if (formType !== "newsletter" && !FIELD_BUILDERS[formType]) {
    return respond(req, 400, { error: "Unknown form type." });
  }
  const invalid = validate(formData, formType);
  if (invalid) {
    return respond(req, 400, { error: invalid });
  }

  // Newsletter signup: just match-or-create the Contact and flip the
  // opt-in checkbox. No Website Inquiries row — a signup isn't an inquiry
  // needing a response, it's a Contact attribute.
  if (formType === "newsletter") {
    try {
      await resolveContact(contactInputFor(formData), { Requested2BAdded2EmailList: true });
    } catch (err) {
      console.error(err);
      return respond(req, 502, { error: "Could not save your submission." });
    }
    return respond(req, 200, { ok: true });
  }

  const buildFields = FIELD_BUILDERS[formType];

  let contactId;
  try {
    contactId = await resolveContact(contactInputFor(formData));
  } catch (err) {
    console.error(err);
    return respond(req, 502, { error: "Could not save your submission." });
  }

  const fields = buildFields(formData);
  fields.Contacts = [contactId];
  fields["Inquiry Message"] = (fields["Inquiry Message"] || "") + sourcePageNote(req);

  let record;
  try {
    record = await createRecord(fields);
  } catch (err) {
    console.error(err);
    return respond(req, 502, { error: "Could not save your submission." });
  }

  const files = formData.getAll("attachment").filter((f) => f && typeof f === "object" && "arrayBuffer" in f && f.size > 0);

  // Uploads are independent calls against the same record/field — confirmed
  // safe to run concurrently (Airtable appends atomically), which matters
  // for latency: several sequential uploads would otherwise stack up.
  const results = await Promise.all(
    files.map((file) => {
      // Client compresses before sending; skip rather than fail the whole
      // submission if one file still slipped through oversized.
      if (file.size > MAX_ATTACHMENT_BYTES) return Promise.resolve(false);
      return uploadAttachment(record.id, PHOTOS_FIELD, file)
        .then(() => true)
        .catch((err) => {
          console.error("Attachment upload failed:", err);
          return false;
        });
    })
  );
  const uploaded = results.filter(Boolean).length;
  const failed = files.length - uploaded;

  // The inquiry itself is saved, so this is still a 200 — but a dropped photo
  // must never look like a clean success. Flag it on the record so whoever
  // reads it knows to ask for the missing photos, and report the shortfall
  // so script.js can tell the visitor (see "photosFailed" there).
  if (failed > 0) {
    try {
      await updateRecord(record.id, {
        "Inquiry Message":
          fields["Inquiry Message"] +
          `\n\n⚠ ${failed} of ${files.length} attached photo${files.length === 1 ? "" : "s"} failed to upload — please ask the sender to email ${failed === 1 ? "it" : "them"}.`,
      });
    } catch (err) {
      console.error("Could not flag failed uploads on the record:", err);
    }
  }

  if (failed > 0 && wantsHtml(req)) {
    return respond(req, 502, { error: `Your message was received, but ${failed} of ${files.length} photos did not upload.` });
  }
  return respond(req, 200, { ok: true, recordId: record.id, photosUploaded: uploaded, photosAttempted: files.length, photosFailed: failed });
};

export const config = { path: "/api/submit-inquiry" };
