# @usersfirst/identity

House Tandem sign-in for any game or site. One account, several logins (Discord, Steam,
Google); this is the client for the account system every House Tandem game shares. The
server half lives in Tandemonium's API (`worker/accounts/`, see its `docs/logins.md`).

Build-free ESM, like `@usersfirst/ui`. The client and the wording have no DOM.

## What's in it

| | |
|---|---|
| `IdentityClient` | the session, sign-in (redirect or device code), linking, the combine question, notices with undo |
| `TEXT`, `noticeText`, `summaryLines` | the flow's words, so every game says the same thing |
| `<uf-device-signin>` | a QR, three steps and the code, for a TV or a desktop build |
| `<uf-account-notice>` | "The Discord account … was linked", with **Not me, remove it** / **OK, that was me** |
| `<uf-combine-accounts>` | both accounts side by side, **Cancel** / **Combine** |

The elements are plain custom elements in the light DOM, styled with `@usersfirst/ui`'s
tokens (`--uf-*`). They import nothing from the UI kit. `<uf-device-signin>` draws its QR
with `<uf-qr>` when the host has registered it.

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

// What changed lately, with undo:
for (const n of await identity.notices()) { /* <uf-account-notice>.notice = n */ }
await identity.undo(notice.id);
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
node packages/identity/tools/demo-check.mjs . <path to puppeteer.js> <out dir>   # the demo in a real browser
```

## Using it in a game

Vendor `packages/identity/src` the way `@usersfirst/ui` is vendored (Tandemonium:
`npm run sync-ui` → `shared/ui/`), and release with a tag `identity-vX.Y.Z`.
