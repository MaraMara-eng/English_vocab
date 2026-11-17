# Deploying Vocab Quest to GitHub Pages

Follow these simple steps to publish your Vocab Quest application live on GitHub Pages with automated CI/CD deployment.

---

## Step 1: Create a GitHub Repository
1. Go to [GitHub](https://github.com/) and log in to your account.
2. Click the **`+`** icon in the top right and select **New repository**.
3. Name your repository (e.g., `vocab-quest`).
4. Choose **Public** (GitHub Pages requires public repositories for free hosting).
5. Leave "Initialize this repository with a README" **unchecked**, then click **Create repository**.

---

## Step 2: Push Your Project Code to GitHub
Open your terminal inside your project root folder and run the following commands (replace `YOUR_USERNAME` and `vocab-quest` with your actual GitHub username and repository name):

```bash
git init
git add .
git commit -m "Initial commit - Vocab Quest production ready"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vocab-quest.git
git push -u origin main
```

---

## Step 3: Enable GitHub Pages & Automated Actions
1. Go to your repository on GitHub and click on **Settings** (gear icon near the top).
2. In the left sidebar, click on **Pages**.
3. Under **Build and deployment** -> **Source**, select **GitHub Actions** (do not select Deploy from a branch).
4. That's it! Every time you push changes to your `main` branch, the included GitHub Action (`.github/workflows/deploy.yml`) will automatically build your app and deploy it live.
5. In a few seconds, your live app URL will appear right there in the GitHub Pages settings!
