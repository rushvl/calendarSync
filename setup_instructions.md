# Google Apps Script to GitHub CI/CD Setup Guide

This guide describes the process of pulling your Google Apps Script project locally, pushing it to GitHub, and setting up automatic deployments (CI/CD) via GitHub Actions.

---

## 🛠️ Step 1: Enable Google Apps Script API

Before using `clasp` (the Google Apps Script CLI), you must enable API access on your Google Account:

1. Visit [Google Apps Script User Settings](https://script.google.com/home/usersettings).
2. Toggle the **Google Apps Script API** to **ON**.

> [!WARNING]
> If this is not enabled, any attempts to log in or push/pull code using `clasp` will fail with an API access error.

---

## 🔑 Step 2: Log in to Clasp locally

Authenticate clasp with your Google Account. 

1. In your terminal, run the following command:
   ```bash
   npm run login
   ```
2. A browser tab will open asking you to authorize clasp. Approve the requested permissions.
3. Once successful, clasp will save your authentication tokens to `~/.clasprc.json` (on Windows, this is usually at `C:\Users\<YourUsername>\.clasprc.json`).

> [!IMPORTANT]
> Keep your `.clasprc.json` file private. The `.gitignore` in this project is already configured to ignore it so it won't be pushed to GitHub.

---

## 📥 Step 3: Clone Your Apps Script Project

Next, you need to pull your code from Google's servers.

1. Go to your Apps Script editor on [script.google.com](https://script.google.com/).
2. Open your script and click on the **Project Settings** (gear icon) on the left panel.
3. Copy the **Script ID**.
4. In your terminal, run:
   ```bash
   npx clasp clone "YOUR_SCRIPT_ID" --rootDir src
   ```
   *(Replace `"YOUR_SCRIPT_ID"` with the ID you copied.)*

This command does two things:
* Creates a `src/` directory and downloads all your script files (typically `.gs` files as `.js` and the `appsscript.json` configuration file) into it.
* Creates a `.clasp.json` file in the project root, mapping your local project to the Google Script.

---

## 🚀 Step 4: Configure GitHub Repository & Secrets

To allow GitHub Actions to push code back to your Google Script, it needs your authentication tokens.

1. Create a repository on GitHub and push this project:
   ```bash
   git add .
   git commit -m "feat: setup project structure and CI/CD workflow"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. Open your GitHub Repository in your web browser.
3. Go to **Settings** -> **Secrets and variables** -> **Actions**.
4. Click **New repository secret**.
5. Set the Name to `CLASPRC_JSON`.
6. For the Value, copy the entire content of your local `.clasprc.json` file.
   * **Windows Command to copy content**:
     ```powershell
     Get-Content ~/.clasprc.json | Set-Clipboard
     ```
   * **macOS / Linux Command**:
     ```bash
     cat ~/.clasprc.json | pbcopy
     ```
7. Paste this JSON into the GitHub secret and click **Add secret**.

---

## 🔄 Step 5: Test the CI/CD Pipeline

The GitHub Actions workflow is configured to trigger whenever you push to the `main` branch.

1. Edit a file inside the `src/` directory (e.g., add a comment or change a variable in your script).
2. Commit and push the changes:
   ```bash
   git add src/
   git commit -m "test: verify CI/CD deployment"
   git push origin main
   ```
3. Navigate to the **Actions** tab on your GitHub repository page to watch the workflow run and automatically deploy your changes to script.google.com!
