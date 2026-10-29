# Lucid Labs AI Agent Creator

Create an editable agent blueprint and portrait using a guided workflow. The
downloaded Markdown is a portable specification; it does not install an agent
or connect email, calls, or any other service.

## Run locally

This project is designed for Vercel's JavaScript functions. With Node.js and
the Vercel CLI available, run `vercel dev` from this directory and open the
local URL it prints. Opening `index.html` directly can display the interface,
but the OpenRouter functions require a Vercel-compatible server.

## Deploy

Import this directory as a Vercel project or run `vercel` from it. The root
`index.html`, `art_styles/`, and `api/` functions must be included in the
deployment. No provider key needs to be configured on the server: each visitor
enters their own OpenRouter key in the interface.

## Push to a Git organization

Create an empty repository in your organization, then from this project folder:

```sh
git add .
git commit -m "Initial agent creator"
git remote add origin <your-organization-repository-url>
git push -u origin main
```

Use the repository URL from your organization. Do not commit API keys or local
Vercel credentials; `.gitignore` excludes local environment and Vercel files.

## Tests

Run `npm test` for the mocked API tests. Run `node tests/creator.e2e.cjs` for
the browser workflow test; it requires Microsoft Edge, or `EDGE_PATH` set to
the Edge executable.

## Privacy and costs

The key is kept in page memory for the current session and sent to the site's
serverless function for each generation request, then to OpenRouter. It is not
saved as part of the local draft. Draft answers and edits are saved in browser
storage on the device; reset the draft when using a shared computer. The
selected OpenRouter models may charge for generation, including retries.

Before using sensitive company information, review the data handling terms for
OpenRouter, the selected model provider, and your deployment host. A generated
blueprint should be reviewed before it is given to an agent harness.
