# Technical Blueprint: The Manus AI WhatsApp Bridge

## 1. Project Vision & Core Problem

The Manus AI platform requires a "headless" interaction model, using the standard WhatsApp application as the primary user interface for workers and clients. This document outlines the technical requirements for the "Bridge," a custom component responsible for creating a bidirectional communication link between the standard WhatsApp mobile app and the Manus AI Brain (the backend).

**Core Constraint:** This system must be built without using the official WhatsApp Business API. It will instead interact with the WhatsApp application at the OS and UI level.

## 2. High-Level System Architecture

The Bridge is an Android application that acts as a secure gateway. Its sole responsibilities are:
1.  **To observe** the WhatsApp application for incoming messages and media.
2.  **To forward** this data securely to the AI Brain's API endpoint.
3.  **To receive** instructions from the AI Brain (via push notifications).
4.  **To execute** these instructions by programmatically sending messages through the WhatsApp UI.

```
+-------------------+      (1. Observe)      +-----------------+      (2. Forward)      +----------------+
| WhatsApp on Phone | <-------------------- |   Android App   | ---------------------> | Manus AI Brain |
| (Standard App)    | ----------------------> | (The "Bridge")  | <--------------------- | (Backend API)  |
+-------------------+      (4. Execute)      +-----------------+      (3. Receive)      +----------------+
                                                                    (Push Notification)
```

## 3. Core Functionality

-   **Read Incoming Messages:** Capture sender information (name/number), message text, and timestamps from incoming WhatsApp messages.
-   **Read Incoming Media:** Detect when an image or other media is received, save it temporarily, and forward it (or a URL to it) to the AI Brain.
-   **Send Outgoing Text Messages:** Programmatically open a chat with a specific contact/number, type a message provided by the AI Brain, and send it.
-   **Reliable Background Operation:** The Bridge must run persistently in the background on a dedicated Android device.

## 4. Technical Implementation (Android)

This is a native Android application project.

### Key Android APIs & Technologies:

1.  **Accessibility Services (The Core Engine):** This is the primary tool for both reading and writing data.
    *   **UI Inspection:** The service will inspect the layout hierarchy (`AccessibilityNodeInfo`) of the active WhatsApp screen to find and extract text from message bubbles, sender headers, and contact info.
    *   **UI Automation:** It will perform actions like `ACTION_SET_TEXT` to fill the message input field and `ACTION_CLICK` to press the "Send" button.
    *   **Resilience:** UI element identifiers (e.g., `view-id`) must be used where available, but the logic must be robust enough to handle changes in the WhatsApp layout.

2.  **Notification Listener Service (For Efficiency):** This is the preferred method for capturing *incoming* messages when WhatsApp is in the background.
    *   **Interception:** The service will listen for notifications from the `com.whatsapp` package.
    *   **Data Extraction:** It will parse the notification's title (`Notification.EXTRA_TITLE`) for the sender's name and the text (`Notification.EXTRA_TEXT`) for the message content.
    *   **Hybrid Approach:** The Bridge should use the Notification Listener as its primary means of receiving messages to save battery. It should only activate full Accessibility Service screen scraping when it needs to send a message or when a conversation is already active on the screen.

3.  **Communication with AI Brain:**
    *   **Forwarding Data (Bridge -> Brain):** When a message is captured, the Bridge will make a secure `POST` request to the AI Brain's API endpoint (e.g., `https://manus.ai/api/bridge/incoming`). The JSON payload must be structured, e.g.:
        ```json
        {
          "sender_id": "whatsapp:+15551234567",
          "message_text": "Stoptime: 17:00",
          "media_url": "https://storage.googleapis.com/bridge/media/12345.jpg", // Optional
          "timestamp": "2024-09-28T12:30:00Z"
        }
        ```
    *   **Receiving Instructions (Brain -> Bridge):** The AI Brain will send instructions to the Bridge using **Firebase Cloud Messaging (FCM)**.
        *   The push notification payload will contain the action to be performed, e.g.:
            ```json
            {
              "action": "SEND_MESSAGE",
              "recipient_id": "whatsapp:+15559876543",
              "message_text": "Hello! Your job is confirmed for Tuesday morning."
            }
            ```
        *   Upon receiving the FCM message, a background service in the Bridge app will wake the device and trigger the Accessibility Service to perform the required UI automation.

## 5. Critical Considerations

-   **Resilience to WhatsApp Updates:** This is the highest risk. The developer must build a robust parsing logic that does not rely on hard-coded screen positions. A configuration file for UI element IDs that can be updated remotely would be a significant advantage.
-   **Device & Power Management:** The Bridge app must run on a dedicated Android device. It must request to be exempted from battery optimization and Doze mode to ensure it can run persistently.
-   **Error Handling & Logging:** The Bridge must have extensive local logging to debug issues with UI automation. It should also have a mechanism to report failures back to the AI Brain (e.g., "Failed to send message to recipient X").
-   **Security:** All communication with the AI Brain must be over HTTPS. The Bridge will authenticate using a secret API key stored securely in the app. The device itself should be physically secure.
-   **Permissions:** The app will require explicit user permission for both Accessibility Services and Notification Access, which must be granted during setup.

This blueprint provides a comprehensive guide for an experienced Android developer to build the WhatsApp Bridge. The successful implementation of this component is critical to realizing the full vision of the Manus AI platform.