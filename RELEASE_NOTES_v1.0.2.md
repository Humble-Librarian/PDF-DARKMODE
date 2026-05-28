# PDF Dark Mode Reader v1.0.2 🦊

This minor patch addresses a brand new, strict Mozilla Add-ons policy regarding data collection transparency.

### 🌟 What's New
* **Data Collection Compliance:** Updated the `manifest.json` to explicitly include the `data_collection_permissions: { required: ["none"] }` flag, which is now strictly mandated by Mozilla for all new extensions. Because this extension operates 100% locally and collects absolutely zero data, this allows it to pass Firefox automated validation!

*(Note: You will still see a yellow warning about `service_worker` and some warnings regarding `eval()`. These are just warnings—Firefox ignores the service worker fallback and the eval warnings are standard for the underlying PDF.js library. They will **not** block publication!)*

### 🛠️ Installation Instructions
1. Download the extension: **[PDF-DARKMODE-v1.0.2.zip](https://github.com/user-attachments/files/PDF-DARKMODE-v1.0.2.zip)**
2. Extract the `.zip` file to a folder on your computer.
3. Open your browser and go to `chrome://extensions/` (or `about:debugging#/runtime/this-firefox` in Firefox).
4. Turn on **Developer mode** / **Load Temporary Add-on**.
5. Select your extracted folder!
