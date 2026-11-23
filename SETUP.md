# Home Inventory: how to use and set up

The whole app is one file, `index.html`. No installing, no server code.

## 1. Try it right now (this computer only)
Download `index.html` and double-click it. It opens in your browser and works straight away.
Data is kept in that browser only, so this is for trying it out.

## 2. What it does
- **Items tab**: everything you own, grouped by place (Fridge, Kitchen…). Tap **−** when you use one, **+** when you add one. Tap an item's name to edit it.
- **Minimum to keep**: when stock drops to this number, the item goes onto the shopping list by itself.
- **Shopping tab**: tick an item when you buy it and its stock goes up automatically. You can also type in extra things to buy.
- **Use soon tab**: things expiring in the next 7 days, plus things likely to run out within 7 days.
- **Runs out in X days**: the app learns from your **−** presses. After a few presses it shows e.g. "2 L/week · ~4 days left".
- **▦ Scan**: scans a barcode with the camera. A known item opens with quick −1/+1 buttons. A new one opens the "Add item" form with the product name filled in where it can find it (from the free Open Food Facts database, mostly food and drink). You can also type the barcode number.
- **Settings › Backup**: download everything as a backup file or as a spreadsheet (CSV, opens in Excel).

## 3. Saving to OneDrive (one-time setup, about 10 minutes)
Your data then lives in **OneDrive › Apps › Home Inventory › inventory.json**, and your phone and computer stay in sync.

Two things are needed:

**a) A web address for the app.** OneDrive sign-in and the phone camera only work when the app is opened from an `https://` address, not a file on your computer. (Claude will help with this step, see the question in the chat.)

**b) Register the app with Microsoft** so it is allowed to ask for your OneDrive:
1. Go to https://entra.microsoft.com and sign in with your Microsoft (Hotmail/Outlook) account. If it asks you to create a free Azure account first, do that. It costs nothing for this.
2. Open **Applications › App registrations › New registration**.
3. Name: `Home Inventory`.
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
5. Redirect URI: choose **Single-page application (SPA)** and paste the app's web address (the app shows the exact address under Settings › OneDrive).
6. Click **Register**. Copy the **Application (client) ID** shown on the next page.
7. Open the app › **Settings**, paste the ID, press **Connect OneDrive**, sign in and accept.

The app only asks for permission to its **own folder** in your OneDrive, not your other files.
On your phone, open the same web address, go to Settings, paste the same ID and connect. Tip: use "Add to Home Screen" to get an app icon.
