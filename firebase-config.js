/* ===================================================================
   Ikhlas Parent Portal — Firebase connection
   ===================================================================

   This app has nothing to show without the cloud, so it always
   requires Firebase — there's no offline/local mode like the main
   school app has. Paste in the SAME config object you already used
   in the main Ikhlas School Manager's own firebase-config.js (Project
   settings > General > "Your apps" in the Firebase console).

   You do NOT need to create a second Firebase project — this app
   reads from the same project, just a different, parent-safe slice
   of it (see README.md > "Parent Portal" for what it can and can't
   see, and the extra Firestore security rules it needs). Naseer
   ------------------------------------------------------------------ */

const FIREBASE_CONFIG = {
   apiKey: "AIzaSyCUOJ-D_CWS5QFbzX8k69WVUv12KJ_h0Ek",
   authDomain: "iks-1-4v-db.firebaseapp.com",
   projectId: "iks-1-4v-db",
   storageBucket: "iks-1-4v-db.firebasestorage.app",
   messagingSenderId: "911159075301",
   appId: "1:911159075301:web:5d620a7914c4f9827f4f0c",
   measurementId: "G-BPQG3B30WR"
};

// Flip this to true only after completing the steps above.
const FIREBASE_ENABLED = true;
