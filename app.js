const authConfig = {
  authorizeUrl: "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  scopes: ["user-library-read", "user-library-modify"],
  redirectUri: "http://127.0.0.1:8000/",
};

const elements = {
  clientId: document.getElementById("clientId"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  removeBtn: document.getElementById("removeBtn"),
  grid: document.getElementById("grid"),
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  countSpinner: document.getElementById("countSpinner"),
  cardTemplate: document.getElementById("cardTemplate"),
};

const state = {
  token: null,
  tokenExpiresAt: 0,
  scopes: [],
  likedTracks: new Map(),
  selectedIds: new Set(),
  loading: false,
};

const storageKeys = {
  token: "spotify_token",
  expires: "spotify_token_expires",
  scopes: "spotify_token_scopes",
  clientId: "spotify_client_id",
  verifier: "spotify_code_verifier",
};

function saveAuthState(token, expiresInSeconds, scopeString = "") {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem(storageKeys.token, token);
  localStorage.setItem(storageKeys.expires, String(expiresAt));
  localStorage.setItem(storageKeys.scopes, scopeString || "");
  state.token = token;
  state.tokenExpiresAt = expiresAt;
  state.scopes = scopeString ? scopeString.split(" ") : [];
}

function clearAuthState() {
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.expires);
  localStorage.removeItem(storageKeys.scopes);
  localStorage.removeItem(storageKeys.verifier);
  state.token = null;
  state.tokenExpiresAt = 0;
  state.scopes = [];
}

function loadStoredClientId() {
  const stored = localStorage.getItem(storageKeys.clientId);
  if (stored) {
    elements.clientId.value = stored;
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setCount(message, isLoading = false) {
  elements.count.textContent = message || "";
  if (elements.countSpinner) {
    elements.countSpinner.style.display = isLoading ? "inline-block" : "none";
  }
}

function updateButtons() {
  const connected = Boolean(state.token) && Date.now() < state.tokenExpiresAt;
  elements.loginBtn.disabled = connected || !elements.clientId.value.trim();
  elements.loginBtn.textContent = connected ? "Connected" : "Connect Spotify";
  elements.logoutBtn.disabled = !connected;
  elements.removeBtn.disabled = !connected || state.selectedIds.size === 0 || state.loading;
}

function setLoading(isLoading, message) {
  state.loading = isLoading;
  if (message) {
    setStatus(message);
  }
  if (isLoading && elements.count.textContent) {
    setCount(elements.count.textContent, true);
  }
  updateButtons();
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  bytes.forEach((value) => {
    text += possible[value % possible.length];
  });
  return text;
}

async function createCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

async function beginAuth() {
  const clientId = elements.clientId.value.trim();
  if (!clientId) return;
  localStorage.setItem(storageKeys.clientId, clientId);
  const verifier = randomString(64);
  const challenge = await createCodeChallenge(verifier);
  localStorage.setItem(storageKeys.verifier, verifier);
  const state = verifier;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: authConfig.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: authConfig.scopes.join(" "),
    state,
    show_dialog: "true",
  });

  window.location.href = `${authConfig.authorizeUrl}?${params.toString()}`;
}

async function exchangeToken(code, fallbackVerifier) {
  const verifier = localStorage.getItem(storageKeys.verifier) || fallbackVerifier;
  const clientId = elements.clientId.value.trim() || localStorage.getItem(storageKeys.clientId);
  if (!verifier || !clientId) {
    throw new Error("Missing code verifier or client ID.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: authConfig.redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch(authConfig.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Token exchange failed: ${detail}`);
  }

  return response.json();
}

function stripAuthParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, document.title, url.toString());
}

async function handleAuthRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const fallbackVerifier = url.searchParams.get("state");
  if (!code) return;
  setLoading(true, "Finalizing Spotify login...");
  try {
    const data = await exchangeToken(code, fallbackVerifier);
    saveAuthState(data.access_token, data.expires_in, data.scope);
    setStatus("");
    await fetchLikedTracks();
  } catch (error) {
    console.error(error);
    setStatus("Login failed. Check your Client ID and redirect URI.");
  } finally {
    stripAuthParams();
    setLoading(false);
  }
}

function loadStoredToken() {
  const token = localStorage.getItem(storageKeys.token);
  const expiresAt = Number(localStorage.getItem(storageKeys.expires) || 0);
  const scopeString = localStorage.getItem(storageKeys.scopes) || "";
  if (token && Date.now() < expiresAt) {
    state.token = token;
    state.tokenExpiresAt = expiresAt;
    state.scopes = scopeString ? scopeString.split(" ") : [];
    setStatus("");
  } else {
    clearAuthState();
    setStatus("");
  }
}

async function fetchLikedTracks() {
  state.likedTracks.clear();
  state.selectedIds.clear();
  elements.grid.innerHTML = "";
  updateButtons();
  setLoading(true);

  let offset = 0;
  const limit = 50;
  let total = 0;
  try {
    while (true) {
      const url = new URL("https://api.spotify.com/v1/me/tracks");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${state.token}` },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to load tracks: ${detail}`);
      }

      const data = await response.json();
      total = data.total;
      if (!data.items.length) break;
      data.items.forEach((item) => {
        state.likedTracks.set(item.track.id, item.track);
        renderTrack(item.track);
      });

      offset += data.items.length;
      setCount(`${offset} / ${total} loaded`, true);
      if (offset >= total) break;
    }

    setCount(`${state.likedTracks.size} total tracks`);
  } catch (error) {
    console.error(error);
    setStatus("Failed to load liked songs");
  } finally {
    setLoading(false);
  }
}

function renderTrack(track) {
  const template = elements.cardTemplate.content.cloneNode(true);
  const card = template.querySelector(".card");
  const cover = template.querySelector(".cover");
  const title = template.querySelector(".title");
  const artist = template.querySelector(".artist");

  cover.src = track.album.images[0]?.url || "";
  cover.alt = track.name;
  title.textContent = track.name;
  artist.textContent = track.artists.map((a) => a.name).join(", ");

  card.dataset.trackId = track.id;
  card.addEventListener("click", () => toggleSelection(card));
  elements.grid.appendChild(template);
}

function toggleSelection(card) {
  const id = card.dataset.trackId;
  if (!id) return;
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    card.classList.remove("selected");
  } else {
    state.selectedIds.add(id);
    card.classList.add("selected");
  }
  updateButtons();
}

function chunkIds(ids, size) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function toTrackUris(ids) {
  return ids.map((id) => `spotify:track:${id}`);
}

async function removeSelected() {
  const ids = Array.from(state.selectedIds);
  if (!ids.length) return;
  if (!state.scopes.includes("user-library-modify")) {
    setStatus("Remove failed: missing user-library-modify scope. Sign out and reconnect.");
    return;
  }
  setLoading(true, "Removing selected tracks...");

  try {
    const batches = chunkIds(toTrackUris(ids), 40);
    for (const batch of batches) {
      const url = new URL("https://api.spotify.com/v1/me/library");
      url.searchParams.set("uris", batch.join(","));
      const response = await fetch(url.toString(), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${state.token}`,
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        if (response.status === 403) {
          setStatus("Remove failed: Spotify rejected the token. Sign out and reconnect.");
        }
        throw new Error(`Remove failed: ${detail}`);
      }
    }

    ids.forEach((id) => {
      state.likedTracks.delete(id);
      const card = elements.grid.querySelector(`[data-track-id="${id}"]`);
      if (card) card.remove();
    });
    state.selectedIds.clear();
    setStatus("Selected tracks removed");
    setCount(`${state.likedTracks.size} total tracks`);
  } catch (error) {
    console.error(error);
    setStatus("Failed to remove selected tracks");
  } finally {
    setLoading(false);
  }
}

function logout() {
  clearAuthState();
  setStatus("");
  setCount("0 total tracks");
  elements.grid.innerHTML = "";
  state.likedTracks.clear();
  state.selectedIds.clear();
  updateButtons();
}

function init() {
  loadStoredClientId();
  loadStoredToken();
  updateButtons();
  handleAuthRedirect();

  elements.clientId.addEventListener("input", updateButtons);
  elements.loginBtn.addEventListener("click", beginAuth);
  elements.logoutBtn.addEventListener("click", logout);
  elements.removeBtn.addEventListener("click", removeSelected);

  if (state.token) {
    fetchLikedTracks();
  }
}

init();
