// Backup i plotë i Firestore në një skedar JSON.
// Ekzekutohet automatikisht çdo javë nga Task Scheduler i Windows ("Vertetimi Backup"),
// ose me dorë:  node tools/backup.js
//
// Skedarët ruhen te:  Documents\Backup Vertetimi\vertetimi-YYYY-MM-DD.json
// Mbahen 12 backup-et e fundit (rreth 3 muaj). Formati është ai i Firestore REST
// (me tipet e fushave), që të mund të rikthehet saktë.
//
// Përdor llogarinë e Firebase CLI (`firebase login`).

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = 'vertetimi-eb5b6';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COLLECTIONS = ['vertetimet', 'klientet', 'users', 'numeruesi', 'verifikimi'];
const KEEP = 12;
const DIR = path.join(os.homedir(), 'Documents', 'Backup Vertetimi');

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(path.join(DIR, 'backup.log'), line + os.EOL); } catch (e) { }
}

async function accessToken() {
    const npmRoot = path.join(process.env.APPDATA || '', 'npm', 'node_modules');
    const auth = require(path.join(npmRoot, 'firebase-tools', 'lib', 'auth'));
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('Nuk jeni të kyçur në Firebase CLI. Ekzekutoni: firebase login');
    return (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
}

async function listAll(token, collection) {
    const docs = [];
    let pageToken = '';
    do {
        const res = await fetch(`${BASE}/${collection}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`,
            { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`${collection}: ${res.status} ${await res.text()}`);
        const page = await res.json();
        docs.push(...(page.documents || []));
        pageToken = page.nextPageToken || '';
    } while (pageToken);
    return docs;
}

async function main() {
    const token = await accessToken();
    const backup = { project: PROJECT, createdAt: new Date().toISOString(), collections: {} };
    for (const c of COLLECTIONS) {
        backup.collections[c] = await listAll(token, c);
    }

    fs.mkdirSync(DIR, { recursive: true });
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = path.join(DIR, `vertetimi-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(backup));

    const counts = COLLECTIONS.map(c => `${c}: ${backup.collections[c].length}`).join(', ');
    const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
    log(`OK ${path.basename(file)} (${mb} MB) — ${counts}`);

    // Fshihen backup-et më të vjetra se 12 të fundit
    const old = fs.readdirSync(DIR).filter(f => /^vertetimi-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP);
    old.forEach(f => { fs.unlinkSync(path.join(DIR, f)); log(`U fshi backup-i i vjetër ${f}`); });
}

main().catch(e => { log('GABIM: ' + e.message); process.exit(1); });
