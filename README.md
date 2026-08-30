# Natasha - Conversational Voice Agent Demo

This is a voice-first intelligent companion and document analyst featuring real-time speech dialogue (using Gemini Live API) and document grounding.

## Prerequisites

- **Node.js**: Version 18 or higher (tested with Node 24).
- **Gemini API Key**: You need an API key from Google AI Studio.

## Setup Instructions

1. **Install Dependencies**
   Run the following command in the project directory:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   Create a `.env` file in the root directory (or copy from `.env.example`) and add your Gemini API Key:
   ```env
   GEMINI_API_KEY="your_api_key_here"
   ```

3. **Running the Application**
   Start the development server:
   ```bash
   npm run dev
   ```
   This will start the Node/Express server and Mount Vite as middleware, running at [http://localhost:3000](http://localhost:3000).

## Project Features

- **Dynamic Multilingual Switching**: Detects whatever language you are speaking (Hindi, Bengali, Spanish, French, etc.) and responds in the same language.
- **Natural Voice and Audio Cadence**: Specifically formatted for Text-to-Speech (TTS) with natural accents.
- **Document Grounding**: Upload files (PDF, text) to ground Natasha's answers on your project context.
