/* =========================================================================
   RoomSet — configuration
   -------------------------------------------------------------------------
   Fill in the placeholders below. This file is a CLASSIC script on purpose:
   it is loaded by both HTML pages AND imported by the service worker
   (sw.js) through importScripts(). Keep it free of import/export.
   ========================================================================= */

var APP_CONFIG = {
  /* ---- Supabase ------------------------------------------------------- */
  supabase: {
    url: "https://pasmemceiqrqbzaanram.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhc21lbWNlaXFycWJ6YWFucmFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNDQ5MjcsImV4cCI6MjEwODkyMDkyN30.z799XydlvXzHmp9NLB2_IvXSJQA6jdB7jEjL-ZoIre8",
  },

  /* ---- Firebase / FCM -------------------------------------------------
     Firebase console -> Project settings -> Your apps -> Web app.
     The VAPID key is under Cloud Messaging -> Web Push certificates.     */
  firebase: {
    apiKey: "AIzaSyCq-MPQ3kGYyhd0BqQL7piE1eg2st1YptI",
    authDomain: "e-room-e28fc.firebaseapp.com",
    projectId: "e-room-e28fc",
    storageBucket: "e-room-e28fc.firebasestorage.app",
    messagingSenderId: "1018926551788",
    appId: "1:1018926551788:web:68a908aaec55087e6f0bc9",
    measurementId: "G-CLX74W8YK7",
    // REQUIRED for web push. Firebase console -> Project settings ->
    // Cloud Messaging -> Web Push certificates -> Generate key pair.
    // Paste the "Key pair" public key here (starts with B...).
    vapidKey: "BIcI_kIiGCZmQcAI_6_9s6thVgkGyxegW9vjY2Zpzoj62OKzW-zXY5GtpIrlY_Fbfirja10ZEBHN1MzySQ9z-YQ",
  },

  /* ---- App behaviour -------------------------------------------------- */
  app: {
    // Minimum time between two visitor pings (also enforced in Postgres).
    pingCooldownMs: 20000,
    // Used when the admin_status row does not exist yet.
    defaultStatus: "in_room",
  },
};

// Explicit global assignment keeps things working when the file is imported
// with importScripts() inside the service worker.
self.APP_CONFIG = APP_CONFIG;
