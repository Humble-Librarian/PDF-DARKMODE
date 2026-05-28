# PDF Dark Mode Reader v1.0.1 🦊

This is a minor patch release focused on bringing full, seamless support to Mozilla Firefox!

### 🌟 What's New
* **Firefox Compatibility:** Fixed Manifest V3 background script compatibility issues specifically for Firefox. The extension now fully supports `gecko` specific settings, meaning it can be published to the Mozilla Add-ons store without any validation errors!
* Maintained all the core features from v1.0.0, including the smart color engine, native search, and Scholar UI.

*(Note: The warnings regarding `eval()` and data collection during Mozilla validation are completely normal and stem from the underlying PDF.js rendering library—they will not prevent the extension from functioning perfectly!)*

### 🛠️ Installation Instructions
1. Download the extension: **[PDF-DARKMODE-v1.0.1.zip](https://github.com/user-attachments/files/PDF-DARKMODE-v1.0.1.zip)** *(Update this link once you upload the zip to your release!)*
2. Extract the `.zip` file to a folder on your computer.
3. Open your browser and go to `chrome://extensions/` (or `about:debugging#/runtime/this-firefox` in Firefox).
4. Turn on **Developer mode** / **Load Temporary Add-on**.
5. Select your extracted folder / manifest file!
