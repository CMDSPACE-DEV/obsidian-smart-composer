# 2.6.6-test.1 — pipeline verification prerelease

**This is not a product release.** It exists only to prove that
`CMDSPACE-DEV/knowledge-base-agent` can build and publish this plugin end to end:
tag push → cross-platform CI → draft release → asset verification → publish.

No feature work is included. The code is Prof. Ahn Chang-hyun's
(`laguna821/obsidian_smart_composer_Achmage`) `2.6.5` tree, imported into this
organization repository with its full commit history; only the version strings
and the CI/release workflows differ.

## What to expect

- Assets: `main.js`, `manifest.json`, `styles.css` — the standard Obsidian plugin
  set, built by the release workflow from the tagged commit.
- Plugin identity is unchanged from upstream (`id: smart-composer`,
  `name: Smart Composer`). It therefore collides with the original Smart Composer
  plugin if both are installed in the same vault. Renaming is a separate decision.
- Marked as a prerelease and never as "latest".

## Provenance

Verified build evidence (workflow run, tagged commit, asset sizes and SHA-256
digests) is appended below by the release workflow itself.
