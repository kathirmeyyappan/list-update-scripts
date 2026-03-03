# life's work update scripts

A collection of scripts for maintaining my anime tracking spreadsheet, [life's work](https://docs.google.com/spreadsheets/d/1MCPi0GCz_YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA/edit?gid=1243461176#gid=1243461176).

## Directories

**`sync/`** — Syncs the spreadsheet + MAL data into a Notion database. Runs as a CLI or a web app hosted at [kathirm.com/sync](https://kathirm.com/sync). See [`sync/README.md`](sync/README.md) for details.

**`python-scripts/`** — Pulls updated MAL scores back into the spreadsheet.

**`r-scripts/`** — Generates data visualizations from the spreadsheet (histograms, scatterplots).

**`google-app-scripts/`** — Legacy Apps Script that predates the `sync/` tooling.

---

The (live) .csv formatted sheet which the R scripts use can be found [here](https://docs.google.com/spreadsheets/d/1MCPi0GCz_YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA/edit#gid=618528452).

Below are some cool visuals of the imported data (generated with R):

![315e834e-671a-40e8-a5be-ccac7ed19b55](https://github.com/kathirmeyyappan/list-update-scripts/assets/71161498/9dc4acb2-178d-49f6-8596-3dbb32c4ba78)

![542b498f-96ee-4f71-98d1-23366336ec74](https://github.com/kathirmeyyappan/list-update-scripts/assets/71161498/4bdf6a91-a4d2-482d-8da5-24d29c99d81e)

![e1897696-eb4b-4019-a7e5-e3c04b927a31](https://github.com/kathirmeyyappan/list-update-scripts/assets/71161498/4780728e-9702-4beb-9342-5c8d174213ae)
