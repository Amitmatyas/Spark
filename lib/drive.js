// Google: admin sign-in and the Drive connection share one OAuth client (oauth-client.json).
// Signing in to the admin page with Google also grants Drive access, saved in data/token.json,
// so client folders and videos live in the "Spark" Drive folder.
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { DATA_DIR } = require("./db");

const ROOT = path.join(__dirname, "..");
const OAUTH_CLIENT_PATH = path.join(ROOT, "oauth-client.json");
// Kept in data/ so it survives Docker rebuilds (data/ is the mounted volume).
const TOKEN_PATH = path.join(DATA_DIR, "token.json");
const OLD_TOKEN_PATH = path.join(ROOT, "token.json");
if (!fs.existsSync(TOKEN_PATH) && fs.existsSync(OLD_TOKEN_PATH)) fs.copyFileSync(OLD_TOKEN_PATH, TOKEN_PATH);
const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID || "1cq_52KVmo-tCYv_Zfr0Y7i1VyA1Tg3gc";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"];

if (!fs.existsSync(OAUTH_CLIENT_PATH)) {
  console.error("Missing oauth-client.json (Google OAuth web client). See README.md.");
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(OAUTH_CLIENT_PATH, "utf8"));
const creds = raw.web || raw.installed;

let redirectUri = "http://localhost:3000/oauth2callback";
const newOAuth = () => new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

// The long-lived client that talks to Drive with the saved token.
let auth = newOAuth();
let drive = google.drive({ version: "v3", auth });

function configure(publicUrl) {
  redirectUri = `${publicUrl.replace(/\/$/, "")}/oauth2callback`;
  auth = newOAuth();
  if (fs.existsSync(TOKEN_PATH)) auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")));
  // Google only sends refresh_token on first consent, so merge instead of overwriting.
  auth.on("tokens", (tokens) => saveToken({ ...auth.credentials, ...tokens }));
  drive = google.drive({ version: "v3", auth });
}

function saveToken(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

const isConnected = () => Boolean(auth.credentials?.refresh_token);

function authUrl(state) {
  return newOAuth().generateAuthUrl({
    access_type: "offline",
    // Ask for consent (which returns a refresh token) only while Drive isn't connected yet.
    prompt: isConnected() ? "select_account" : "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
}

// Exchange the sign-in code; returns the verified email. Saves Drive access when granted.
async function finishSignIn(code) {
  const client = newOAuth();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: creds.client_id });
  const { email, email_verified: verified } = ticket.getPayload();
  if (!verified) throw new Error("Google account email is not verified");
  return {
    email: email.toLowerCase(),
    // Only take over Drive when it isn't connected, so a second admin signing in
    // doesn't switch the studio's Drive to their own account.
    saveDrive() {
      if (!isConnected() && tokens.refresh_token && String(tokens.scope).includes("/auth/drive")) {
        auth.setCredentials(tokens);
        saveToken(tokens);
      }
    },
  };
}

function disconnect() {
  auth.setCredentials({});
  for (const file of [TOKEN_PATH, OLD_TOKEN_PATH]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function errorMessage(err) {
  const apiError = err?.response?.data?.error;
  if (typeof apiError === "string") return err.response.data.error_description || apiError;
  return apiError?.message || err?.errors?.[0]?.message || err?.message || "Google Drive error";
}
const needsReconnect = (err) => /invalid_grant|invalid_token|Invalid Credentials|No refresh token/i.test(errorMessage(err));

async function account() {
  const { data } = await drive.about.get({ fields: "user(emailAddress)" });
  return data.user?.emailAddress || null;
}

const escapeQuery = (value) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const common = { supportsAllDrives: true };

async function listFolders() {
  const out = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${PARENT_FOLDER_ID}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "nextPageToken, files(id, name, createdTime)",
      orderBy: "name",
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      ...common,
    });
    out.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Reuse a folder with the same name instead of creating a duplicate.
async function ensureFolder(name) {
  const { data: found } = await drive.files.list({
    q: `'${PARENT_FOLDER_ID}' in parents and mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(name)}' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    includeItemsFromAllDrives: true,
    ...common,
  });
  if (found.files.length) return found.files[0].id;
  const { data } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [PARENT_FOLDER_ID] },
    fields: "id",
    ...common,
  });
  return data.id;
}

const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;

async function listVideos(folderId) {
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
    fields: "files(id, name, size, mimeType, createdTime, thumbnailLink, videoMediaMetadata(width, height, durationMillis))",
    orderBy: "createdTime desc",
    pageSize: 1000,
    includeItemsFromAllDrives: true,
    ...common,
  });
  return data.files.map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size) || 0,
    mimeType: f.mimeType,
    createdTime: f.createdTime,
    hasThumb: Boolean(f.thumbnailLink),
    width: f.videoMediaMetadata?.width || null,
    height: f.videoMediaMetadata?.height || null,
    duration: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) / 1000 : null,
  }));
}

async function fileParents(fileId) {
  const { data } = await drive.files.get({ fileId, fields: "parents, mimeType, name, size, thumbnailLink", ...common });
  return data;
}

async function upload(folderId, file) {
  const { data } = await drive.files.create({
    requestBody: { name: file.originalname, parents: [folderId] },
    media: { mimeType: file.mimetype, body: fs.createReadStream(file.path) },
    fields: "id, name, size",
    ...common,
  });
  return data;
}

async function trash(fileId) {
  await drive.files.update({ fileId, requestBody: { trashed: true }, ...common });
}

// Stream a Drive file to the browser, passing through Range so <video> can seek.
async function stream(fileId, req, res, { download = false, name = "video.mp4", mimeType = "video/mp4" } = {}) {
  const headers = req.headers.range ? { Range: req.headers.range } : {};
  const r = await drive.files.get({ fileId, alt: "media", ...common }, { responseType: "stream", headers });
  // Newer googleapis returns a fetch Headers object; older ones a plain object.
  const header = (k) => (typeof r.headers.get === "function" ? r.headers.get(k) : r.headers[k]);
  res.status(r.status);
  for (const h of ["content-length", "content-range", "last-modified", "etag"]) {
    if (header(h)) res.setHeader(h, header(h));
  }
  const type = header("content-type");
  res.setHeader("content-type", type && !type.startsWith("application/") ? type : mimeType);
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "private, max-age=3600");
  if (download) res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  r.data.on("error", () => res.destroy());
  req.on("close", () => r.data.destroy());
  r.data.pipe(res);
}

async function thumbnail(fileId, res) {
  const meta = await fileParents(fileId);
  if (!meta.thumbnailLink) return res.status(404).end();
  const { token } = await auth.getAccessToken();
  const r = await fetch(meta.thumbnailLink.replace(/=s\d+$/, "=s720"), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return res.status(404).end();
  res.setHeader("content-type", r.headers.get("content-type") || "image/jpeg");
  res.setHeader("cache-control", "private, max-age=86400");
  res.end(Buffer.from(await r.arrayBuffer()));
}

module.exports = {
  configure, authUrl, finishSignIn, disconnect, isConnected, account, errorMessage, needsReconnect,
  listFolders, ensureFolder, folderUrl, listVideos, fileParents, upload, trash, stream, thumbnail,
  PARENT_FOLDER_ID,
};
