const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE_NAME;
const TOKEN = process.env.AIRTABLE_TOKEN;
const CONTACTS_TABLE = "Contacts";

function authHeaders(extra) {
  return Object.assign({ Authorization: `Bearer ${TOKEN}` }, extra || {});
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Case-insensitive exact match on Contacts.Email. Returns the first match
// only — pre-existing duplicate Contacts (from before this lookup existed)
// aren't reconciled here, just not added to.
export async function findContactByEmail(email) {
  if (!email) return null;
  const formula = `LOWER({Email}) = LOWER("${escapeFormulaString(email)}")`;
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CONTACTS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Airtable contact lookup failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.records[0] || null;
}

export async function createContact(fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CONTACTS_TABLE)}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Airtable contact create failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function updateContact(recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CONTACTS_TABLE)}/${recordId}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Airtable contact update failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function createRecord(fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Airtable create failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// Airtable's content API appends a single attachment to the given field on
// each call — confirmed empirically, not a documented guarantee — so callers
// upload files one at a time against an already-created record.
export async function uploadAttachment(recordId, fieldIdOrName, file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const res = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldIdOrName}/uploadAttachment`,
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        contentType: file.type || "application/octet-stream",
        filename: file.name || "upload",
        file: buffer.toString("base64"),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Airtable attachment upload failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
