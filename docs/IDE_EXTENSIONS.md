# IDE extensions — publishing checklist

This document covers the **manual** marketplace-publishing steps for the
two aistack IDE extensions:

- `extensions/vscode/` — VS Code extension (TypeScript, packaged with `vsce`).
- `extensions/jetbrains/` — JetBrains plugin (Kotlin, packaged with Gradle).

The build artifacts can be produced reproducibly in CI; **publishing must
be performed by a human** with the appropriate accounts and credentials.
Neither marketplace permits automated first-time submission without manual
review.

---

## 1. VS Code Marketplace

### One-time setup

1. **Publisher account.** Create a publisher at
   <https://marketplace.visualstudio.com/manage>. The publisher ID must match
   `package.json -> publisher` (currently `aigensolutions`). Verify the
   publisher with a domain DNS record (required for the verified-badge).
2. **Azure DevOps account.** VS Code Marketplace identities live under Azure
   DevOps. Sign in at <https://dev.azure.com>.
3. **Personal Access Token (PAT).** From Azure DevOps:
   `User Settings → Personal access tokens → New Token`.
   - **Organization**: `All accessible organizations`
   - **Scopes**: `Custom defined` → `Marketplace → Manage`
   - **Expiry**: 90 days max (rotate before expiry).
   - Save the token in a password manager. **Do not commit it.**

### Per-release procedure

```bash
cd extensions/vscode
npm ci
npm run compile
npm run package                 # produces aistack-vscode-<version>.vsix
```

Verify the artifact before publishing:

```bash
unzip -l aistack-vscode-<version>.vsix    # inspect contents
code --install-extension aistack-vscode-<version>.vsix   # smoke test locally
```

Publish:

```bash
npx vsce login aigensolutions   # paste PAT
npx vsce publish                # or: vsce publish patch | minor | major
```

Alternative: upload the `.vsix` manually at
<https://marketplace.visualstudio.com/manage/publishers/aigensolutions>.

### Marketplace listing checklist

- [ ] `package.json` `version` bumped (semver).
- [ ] `package.json` `description`, `keywords`, `categories` reviewed.
- [ ] `media/icon.png` present (128x128, PNG, on opaque background).
- [ ] `README.md` renders correctly (links resolved, screenshots embedded).
- [ ] `CHANGELOG.md` updated (Marketplace renders it on the listing).
- [ ] LICENSE file present.
- [ ] All screenshots captured per the recording instructions in
      `extensions/vscode/README.md`.

### Review SLA

VS Code Marketplace runs an automated malware/static scan (~minutes) plus
periodic manual spot-checks. New publishers are sometimes manually
reviewed before the first listing goes live (1–3 business days). Updates
to an existing extension usually appear within minutes.

---

## 2. JetBrains Marketplace

### One-time setup

1. **JetBrains account.** Sign in at <https://account.jetbrains.com/>.
2. **Vendor profile.** Create a vendor at
   <https://plugins.jetbrains.com/author/me> (one vendor can publish multiple
   plugins). The vendor name maps to `plugin.xml -> <vendor>`.
3. **Signing certificate.** As of platform 2021.1, plugins must be signed.
   Generate a self-signed cert per the official guide:
   <https://plugins.jetbrains.com/docs/intellij/plugin-signing.html>.
   You will obtain:
   - `chain.crt` — set `CERTIFICATE_CHAIN` env var to its **contents**.
   - `private.pem` — set `PRIVATE_KEY` env var to its **contents**.
   - `PRIVATE_KEY_PASSWORD` — the password you used to encrypt the key.
4. **Publish token.** From <https://hub.jetbrains.com/users/me/auth-tokens>,
   create a token with the `Marketplace` scope and store it as
   `PUBLISH_TOKEN`. Rotate every 90 days.

### Per-release procedure

```bash
cd extensions/jetbrains
./gradlew clean buildPlugin     # produces build/distributions/aistack-jetbrains-<version>.zip
./gradlew verifyPlugin          # MUST pass with 0 errors
./gradlew runPluginVerifier     # (optional) checks compatibility with all targeted IDEs
./gradlew signPlugin            # requires CERTIFICATE_CHAIN, PRIVATE_KEY, PRIVATE_KEY_PASSWORD
./gradlew publishPlugin         # requires PUBLISH_TOKEN
```

Alternative: upload the signed `.zip` manually at
<https://plugins.jetbrains.com/plugin/add>.

### Marketplace listing checklist

- [ ] `build.gradle.kts -> version` bumped (semver).
- [ ] `plugin.xml -> <change-notes>` updated.
- [ ] `plugin.xml -> <idea-version since-build / until-build>` reviewed against
      the latest IntelliJ release.
- [ ] `./gradlew verifyPlugin` — 0 errors.
- [ ] `./gradlew runPluginVerifier` — 0 errors against all target IDE builds
      (IC, IU, PY, WS, GO, RD, AI-Studio).
- [ ] Plugin icon present at `src/main/resources/META-INF/pluginIcon.svg`
      (and optional `pluginIcon_dark.svg`).
- [ ] All screenshots captured per the recording instructions in
      `extensions/jetbrains/README.md`.

### Review SLA

JetBrains performs a **manual review** of every new plugin and every major
update — typically **1–5 business days**. Patch updates that change only
the version number and bundled binary are usually auto-approved within
hours after the first manual review of the plugin ID.

Common review-rejection causes:

- Missing/invalid signing.
- `until-build` set to a too-narrow range (use `2NN.*`).
- Plugin name conflicts with existing trademark.
- Missing privacy-policy URL when the plugin transmits any user data.
  **aistack transmits user code to the local daemon**; add a privacy
  notice in the description if the daemon is configured to point at a
  remote host.

---

## 3. Shared release process

1. Tag the release: `git tag ide-extensions-vX.Y.Z`.
2. Push the tag (operator only): `git push --tags`.
3. Run the per-release procedures above for both extensions.
4. Update the top-level [`README.md`](../README.md) with install links
   to both marketplace listings.
5. Announce on the project changelog.

## 4. Out-of-scope for the engineering agent

- Creating publisher / vendor accounts.
- Generating signing certificates.
- Generating PATs / publish tokens.
- Actually invoking `vsce publish` / `gradlew publishPlugin`.
- Capturing real screenshots (requires a running daemon and IDE
  sessions — neither available in the sandbox).

All of the above must be performed by a human operator with access
to the corresponding accounts and a workstation capable of running the
IDEs interactively.
