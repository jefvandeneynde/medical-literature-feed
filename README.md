# Medical Literature Feed

A personal, mobile-first literature dashboard for keeping up with medicine and cardiology without juggling dozens of feeds, tables of contents, social accounts, and publisher sites.

## What V1 does

- Pulls recent literature from PubMed on a schedule with GitHub Actions.
- Uses an editable topic taxonomy focused on cardiology, congenital heart disease, and broad internal medicine.
- Deduplicates records by PMID/DOI.
- Provides a responsive feed for phone and desktop.
- Filters by topic, article type, journal, year, open-access/full-text status, and free text.
- Has **For you**, **Newest**, **Must read**, and **Reading list** views.
- Stores reading-list, read, and hidden state locally in the browser.
- Links directly to PubMed, DOI/publisher, available PMC full text, and Paperpile.
- Includes a direct **Open Paperpile** shortcut.

## Paperpile integration

Paperpile does not currently expose a generally available public API that this site can safely use for two-way star synchronization. V1 therefore deliberately does **not** store Paperpile or Google credentials.

The **Paperpile** button opens the best article landing page (DOI first, otherwise PubMed) in a new tab. When the Paperpile browser extension is installed and you are logged in to Paperpile in that browser, you can save the reference/PDF from there. The site keeps its own reading-list star locally for now.

The data model already keeps DOI/PMID identifiers so direct import + star synchronization can be added cleanly when Paperpile exposes a supported API/OAuth flow.

## Editing your topic hierarchy

The taxonomy lives in [`config/topics.json`](config/topics.json). You can edit it at any time in GitHub. Each topic has:

- `id`: stable internal name
- `label`: what appears in the UI
- `group`: parent group
- `query`: PubMed query used during ingestion
- `weight`: default relevance weight (1–5)
- `enabled`: whether it is included in ingestion

After a taxonomy change, the next GitHub Action run refreshes the feed automatically. You can also run the workflow manually from the **Actions** tab.

## Hosting

The site lives in `/docs` so it can be published with GitHub Pages.

In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs`**.

If your GitHub plan does not permit Pages for a private repository, either make this repository public (the app contains no credentials) or connect the private repository to another static host. Personal reading state remains in your browser in V1.

## Data refresh

`.github/workflows/update-literature.yml` runs four times daily and on relevant source/config changes. It fetches the latest seven days and merges them with the existing archive. The first run bootstraps approximately 60 days.

No API secrets are required for the PubMed-only V1.

## Planned next steps

1. Optional cross-device state sync (small authenticated database, e.g. Supabase).
2. Legal open-access PDF resolution through Europe PMC/Unpaywall.
3. Selected society/publisher feeds for items that PubMed misses or indexes slowly.
4. Better personalized scoring based on stars/hides/reads.
5. Paperpile two-way synchronization when a supported API is available.
6. Optional concise AI-generated “Why this may matter” summaries, clearly separated from abstracts.
