# @usersfirst/identity

House Tandem sign-in for any game or site. One account, several logins (Discord, Steam,
Google); this is the client for the account system every House Tandem game shares. The
server half lives in Tandemonium's API (`worker/accounts/`, see its `docs/logins.md`).

Build-free ESM, like `@usersfirst/ui`. The client and the wording have no DOM.

## What's in it

| | |
|---|---|
| `IdentityClient` | the session, sign-in (redirect or device code), linking, the combine question, notices with undo, the account's games, delete |
| `TEXT`, `noticeText`, `summaryLines` | the flow's words, so every game says the same thing |
| `<uf-signin>` | "Sign in with Discord" / "Sign in with Steam", for a browser on the same device |
| `<uf-profile-card>` | the account's logins, one line each, with a **Link** button for a missing one |
| `<uf-device-signin>` | a QR, three steps and the code, for a TV or a desktop build |
| `<uf-account-notice>` | "The Discord account … was linked", with **Not me, remove it** / **OK, that was me** |
| `<uf-combine-accounts>` | both accounts side by side, **Cancel** / **Combine** |

The elements are plain custom elements in the light DOM, styled with `@usersfirst/ui`'s
tokens (`--uf-*`). They import nothing from the UI kit. `<uf-device-signin>` draws its QR
with `<uf-qr>` when the host has registered it.

## Coming from a site with its own sign-in code (0.4)

- **A hand-off code.** `await identity.redeemHandoff()` takes `?ht_code=…` off the address and swaps it for a session (the other end of `handoff()`). It answers `null` when there was no code, else `{ signedIn }`. A code that is refused or has expired leaves the session already here alone.
- **An old link.** `resume()` refuses an expired token in the address (`{ signedIn: false, expired: true }`) and keeps the stored session.
- **A token the server no longer takes.** `new IdentityClient({ forgetOn401: true })` makes `refresh()` end the session on any 401. Without it only `account_gone` does, and `meStatus` says 401 for the host to decide.
- **A stored token with no stored profile.** Point `keys.token` at the key the site already used. The client reads the token alone as a session, named by the token's own claims, and `refresh()` then stores the profile under `keys.user`.

## Fitting the elements into a host (0.3)

- **Size.** Every size inside `<uf-signin>` and `<uf-profile-card>` is in em. `size="sm"` is 13px, `size="lg"` is 22px, and the default follows `--uf-size-md` (16px). For any other size set one `font-size` on the element.
- **Width.** `block` makes the buttons and lines fill the element (a narrow popup, a phone).
- **Sign out.** `<uf-profile-card signout="danger">` shows it in the danger colour.
- **Updates keep focus.** Setting a property (`busy`, `error`, `note`, `links`, `user`, a notice) changes the nodes that are there. A button that is still wanted is never replaced or moved, so controller or keyboard focus stays on it, and so does a class the host added. A picture the host swapped for a cached copy stays until the address the element was given changes. A busy button is `aria-disabled`, not `disabled`, because a browser takes focus away from a disabled button.
- **Reaching the buttons.** `el.buttons()` lists an element's buttons top to bottom, for a host that keeps its own focus list. `signin.button('steam')`, `card.button('link', 'steam')` and `card.button('signout')` give one. `el.named(part)` finds any named part; the names are `data-part` values and are a contract:
  - `<uf-signin>`: `signin-<provider>`, `error`
  - `<uf-profile-card>`: `login-<provider>`, `link-<provider>`, `pic-<provider>`, `signout`, `error`, `note`
  - `<uf-account-notice>`: `undo`, `ok` · `<uf-combine-accounts>`: `no`, `yes` · `<uf-device-signin>`: `open`
- **Hiding one button.** Set `hidden` on a button (`signin.button('discord').hidden = true`). It stays hidden across renders and is left out of `buttons()`.
- `el.renderNow()` renders at once, for a host that needs the buttons right after setting a property.

## Use

```js
import { IdentityClient } from '@usersfirst/identity';

const identity = new IdentityClient({
  apiBase: 'https://api.housetandem.com',
  keys: { user: 'mygame_auth_user', token: 'mygame_auth_token' },   // each site keeps its own session
  deviceId: () => getDeviceId(),            // a guest's rides on this device join the account at sign-in
});

identity.onChange((user, reason) => renderProfile(user));

// A browser on the same device:
await identity.signInRedirect('discord');   // leaves the page…
await identity.resume();                    // …and on the way back, signs in

// A TV or a desktop build:
const dev = await identity.startDevice({
  onStatus: (s) => { panel.status = s === 'confirming' ? 'confirming' : 'waiting'; },
  onDone: (user, info) => { /* user, or info.error: 'expired' | 'cancelled' | 'has_account' */ },
});
panel.url = dev.url; panel.code = dev.code;

// Signed in, add another login:
await identity.linkRedirect('steam');       // on the way back, resume() answers:
const back = await identity.resume();       // { link: 'linked' } or { link: 'combine', id, provider, other, into }
if (back?.link === 'combine') { dialog.question = back; /* then */ await identity.combine(back.id, true); }

// Linking needs a sign-in from the last few minutes. A browser can't get one quietly:
// "Confirm it's you" signs in again, and resume() says what to carry on with.
try { await identity.linkRedirect('steam'); } catch (e) { if (e.fresh) await identity.confirmRedirect('discord', 'link:steam'); }
// …back on the page: (await identity.resume()).after === 'link:steam'

// What changed lately, with undo:
for (const n of await identity.notices()) { /* <uf-account-notice>.notice = n */ }
await identity.undo(notice.id);

// The account across games, and its end:
await identity.games();                     // { dice: { earned, stats, playtime }, tandemonium: … }
await identity.deleteAccount('DELETE');     // the server wants the typed word
```

## Rules the server enforces (and this client follows)

- **A link needs a recent sign-in.** When the server answers `fresh_signin`, the client
  calls your `reauth` once (the Steam build signs in again by ticket). Without one, the
  error has `fresh: true`: ask the player to sign in again, then link.
- **Only the tab or device that began a link can finish it.** The request's secret stays in
  this tab (`sessionStorage`).
- **Nothing combines without a yes.** A login that already has its own account comes back
  as a question, with both accounts' numbers.
- **A session is a login.** Its account is whatever account that login belongs to now, so
  the same token keeps working through a combine or a separate. When an undo reports
  `signed_out`, the session's own login left with the other account: sign in again, or
  `refresh()`, to show it.

## Develop

```
npm test --workspace @usersfirst/identity      # the client against a fake API; wording; element html
npm run typecheck --workspace @usersfirst/identity
npx serve .                                    # then open /packages/identity/demo.html
node packages/identity/tools/demo-check.mjs    # the demo in a real browser (headless)
```

## Using it in a game

Vendor `packages/identity/src` the way `@usersfirst/ui` is vendored (Tandemonium:
`npm run sync-ui` → `shared/ui/`), and release with a tag `identity-vX.Y.Z`.
