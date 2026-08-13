import { createRecord, uploadAttachment, findContactByEmail, createContact, updateContact } from "./lib/airtable.mjs";

const PHOTOS_FIELD = "Photos";
// Netlify Functions cap request bodies at 6MB; base64-encoding a file adds
// ~33% overhead, so a single attachment must stay well under that raw.
const MAX_ATTACHMENT_BYTES = 4.3 * 1024 * 1024;

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
    return new Response(JSON.stringify({ error: "Invalid form submission" }), { status: 400 });
  }

  // Honeypot: report success without writing anything, so bots don't learn
  // their submission was rejected.
  if (formData.get("_honey")) {
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  const formType = formData.get("form");

  // Newsletter signup: just match-or-create the Contact and flip the
  // opt-in checkbox. No Website Inquiries row — a signup isn't an inquiry
  // needing a response, it's a Contact attribute.
  if (formType === "newsletter") {
    try {
      await resolveContact(contactInputFor(formData), { Requested2BAdded2EmailList: true });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: "Could not save your submission" }), { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  const buildFields = FIELD_BUILDERS[formType];
  if (!buildFields) {
    return new Response(JSON.stringify({ error: "Unknown form type" }), { status: 400 });
  }

  let contactId;
  try {
    contactId = await resolveContact(contactInputFor(formData));
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Could not save your submission" }), { status: 502 });
  }

  const fields = buildFields(formData);
  fields.Contacts = [contactId];

  let record;
  try {
    record = await createRecord(fields);
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Could not save your submission" }), { status: 502 });
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

  return new Response(
    JSON.stringify({ ok: true, recordId: record.id, photosUploaded: uploaded, photosAttempted: files.length }),
    { headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/submit-inquiry" };
