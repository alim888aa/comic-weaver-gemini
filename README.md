<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

Comic Weaver is an interactive, AI-assisted comic storytelling app that dynamically generates panels, dialogue, and moods for fast, engaging play. It was created for the [Kaggle Banana competition hackathon](https://www.kaggle.com/competitions/banana/).

The app was initially prototyped in Google AI Studio. 
It uses Gemini-2.5-Flash-Image-Preview for image generation, Gemini-2.5-Flash for text and mood generation and ElevenLabs for sound effects . 
The user can choose between three different themes/settings and make choices that affect the storyline and panels. There are four moods for the story genre and the user's choices will increase one of the moods. The application uses indexedDB for storing the character references and previous story. Also, it utilizes xstate for state management and orchestration.         

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
3. Enter your Gemini API key and ElevenLabs API key (must have sound effect generation access)