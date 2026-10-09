// Njëherësh: u jep kod QR (verify_token) vërtetimeve ekzistuese që s'e kanë
// dhe krijon kopjen publike te verifikimi/{token}.
//
// Përdorimi (pas `firebase login`):
//   node tools/shto-qr-vertetimeve-ekzistuese.js          -> vetëm tregon sa do të ndryshohen
//   node tools/shto-qr-vertetimeve-ekzistuese.js --apliko -> i shkruan në Firestore
//
// Përdor llogarinë e Firebase CLI (pronari i projektit), prandaj nuk varet nga rregullat.

const path = require('path');
const crypto = require('crypto');

const PROJECT = 'vertetimi-eb5b6';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const APLIKO = process.argv.includes('--apliko');

function firebaseTools() {
    const npmRoot = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : '/usr/local/lib/node_modules';
    return require(path.join(npmRoot, 'firebase-tools', 'lib', 'auth'));
}

async function accessToken() {
    const auth = firebaseTools();
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('Nuk jeni të kyçur. Ekzekutoni: firebase login');
    const tok = await auth.getAccessToken(account.tokens.refresh_token, []);
    return tok.access_token;
}

function generateVerifyToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    return Array.from(crypto.randomBytes(20), b => chars[b % chars.length]).join('');
}

// E njëjta llogaritje si expiryDateStr() në index.html
function expiryDateStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1 + 6, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d, lastDay));
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

const str = f => (f && f.stringValue) || '';
const arr = f => ((f && f.arrayValue && f.arrayValue.values) || []).map(v => v.stringValue || '');
const sVal = s => ({ stringValue: s });
const aVal = a => ({ arrayValue: { values: a.map(sVal) } });

async function api(token, method, url, body) {
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
    return res.json();
}

async function main() {
    const token = await accessToken();

    const docs = [];
    let pageToken = '';
    do {
        const page = await api(token, 'GET', `${BASE}/vertetimet?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
        docs.push(...(page.documents || []));
        pageToken = page.nextPageToken || '';
    } while (pageToken);

    const pa = docs.filter(d => !str(d.fields.verify_token));
    console.log(`Vërtetime gjithsej: ${docs.length} | pa QR: ${pa.length}`);
    if (!APLIKO) {
        console.log('Asgjë nuk u ndryshua. Për t\'i shkruar: shtoni --apliko');
        return;
    }

    // Shkrimet bëhen me commit atomik në grupe (çdo vërtetim + kopja publike së bashku)
    const writes = [];
    for (const d of pa) {
        const f = d.fields;
        const vt = generateVerifyToken();
        const data = str(f.data);
        writes.push({
            update: { name: d.name, fields: { verify_token: sVal(vt) } },
            updateMask: { fieldPaths: ['verify_token'] },
            currentDocument: { exists: true }
        });
        writes.push({
            update: {
                name: `projects/${PROJECT}/databases/(default)/documents/verifikimi/${vt}`,
                fields: {
                    nr_v: sVal(str(f.nr_v)), klienti: sVal(str(f.klienti)), adresa: sVal(str(f.adresa)),
                    tipi: sVal(str(f.tipi) || 'privat'), data: sVal(data), skadon: sVal(data ? expiryDateStr(data) : ''),
                    sherbimet: aVal(arr(f.sherbimet)), pestat: aVal(arr(f.pestat))
                }
            },
            currentDocument: { exists: false }
        });
    }

    for (let i = 0; i < writes.length; i += 400) {
        await api(token, 'POST', `${BASE}:commit`, { writes: writes.slice(i, i + 400) });
        console.log(`U shkruan ${Math.min(i + 400, writes.length) / 2} / ${pa.length}`);
    }
    console.log('Përfundoi.');
}

main().catch(e => { console.error('GABIM:', e.message); process.exit(1); });
