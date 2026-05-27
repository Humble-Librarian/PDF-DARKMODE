# 🌙 PDF Dark Mode Reader

A powerful, fast, and completely customizable PDF reader extension for Chrome/Brave/Edge that brings true dark mode to your documents. It doesn't just invert colors; it features a smart color-preserving engine that ensures colored text, links, and images remain vibrant while eliminating blinding white backgrounds.

Perfect for researchers, students, and night owls who want to read comfortably without eye strain.

## ✨ Key Features

- **Smart Color Engine:** Automatically maps stark white backgrounds to a soothing dark grey, while *preserving* the original hues of colored text and images. Blue links stay blue!
- **Scholar-Style UI:** A clean, modern top-toolbar interface inspired by Google Scholar's PDF reader, complete with page navigation and zoom controls.
- **Lightning Fast Native Search:** A fully custom search engine that extracts text in the background, highlights exact matches directly on the dark canvas, and smoothly scrolls to them.
- **Floating Outline Sidebar:** Quickly navigate through the document using the collapsible thumbnail sidebar.
- **Privacy First:** All rendering and text extraction happens locally on your machine. Your PDFs are never uploaded to any external server.

## 🚀 How It Helps Readers

Reading long research papers, textbooks, or reports on a screen can cause severe eye fatigue due to bright white backgrounds acting like a flashlight pointed at your face. 
This extension solves that by converting any PDF into a premium dark mode experience. The smart color inversion algorithm guarantees that important color-coded information (like red warning text, blue hyperlinks, or colorful charts) remains perfectly legible, making it the ultimate tool for late-night studying and extended reading sessions.

## 🛠️ Installation (Developer Mode)

Since this extension is not yet published on the Web Store, you can easily install it locally in a few clicks:

1. **Download the Extension:**
   - Click the green **Code** button at the top of this repository and select **Download ZIP**.
   - Extract the downloaded ZIP file to a folder on your computer (e.g., your Desktop or Documents folder).

2. **Open Extensions Page:**
   - In Chrome, Brave, or Edge, type `chrome://extensions/` (or `edge://extensions/`) into your URL bar and press Enter.

3. **Enable Developer Mode:**
   - Turn on the **Developer mode** toggle switch, usually located in the top right corner of the page.

4. **Load the Extension:**
   - Click the **Load unpacked** button that appears in the top left.
   - Select the folder you extracted in Step 1.

5. **You're Done!**
   - The PDF Dark Mode extension is now installed. You can click its icon in your browser toolbar to start reading PDFs in comfort!

## 💻 Technical Details
- Built using **PDF.js** for robust, client-side PDF rendering.
- Uses `CanvasRenderingContext2D.getImageData()` coupled with a high-performance HSL pixel transformation algorithm for smart dark mode.
- Uses standard Web APIs (`IntersectionObserver`, `window.find`, DOM TreeWalkers) for smooth scrolling and accurate text highlighting.

## 📄 License
This project is open-source and free to use.
