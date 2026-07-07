# Google Apps Script CI/CD Boilerplate

This repository contains the setup files and configurations required to sync a Google Apps Script project locally, push it to GitHub, and automatically deploy code changes to Google Apps Script via GitHub Actions CI/CD.

## 📁 Repository Structure

- `.github/workflows/deploy.yml`: The GitHub Actions workflow for automatic deployment.
- `.gitignore`: Specifying files to keep out of version control (like Google API credentials).
- `package.json`: Contains scripts and dependencies (`@google/clasp`).

---

## 🚀 Quick Start & Setup

For step-by-step instructions on setting up your credentials, cloning your script, and configuring GitHub secrets, please refer to the:

👉 **[Setup Guide](setup_instructions.md)** (or view the [Artifact Setup Guide](file:///C:/Users/rushi/.gemini/antigravity-cli/brain/b2b7bda5-ab01-419e-8810-6548c32e9410/setup_instructions.md))

---

## 🛠️ Usage Commands

| Command | Description |
| :--- | :--- |
| `npm run login` | Authenticate `clasp` locally with your Google account. |
| `npx clasp clone "<scriptId>" --rootDir src` | Clone an existing Google Apps Script locally to the `src/` folder. |
| `npm run pull` | Pull the latest changes from Google Apps Script. |
| `npm run push` | Push local changes to Google Apps Script. |
| `npm run deploy` | Create a new deployment version of the script. |
| `npm run logout` | Log out of `clasp` locally. |
