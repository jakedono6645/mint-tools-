// Shared settings for mint-survey.html and mint-survey-results.html.
// Fill these in once. The anon key is meant to be public (the SQL file locks the data down).
window.MINT_SURVEY = {
  // Supabase -> Project Settings -> API
  SUPABASE_URL: "https://auqgahjioeuzcmllywld.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_EjyjPctzQ1O3OgT1rZL-Xw_Ly88pIGy",  // public (publishable) key, safe in the browser

  // Google review link. Find your Place ID at
  // https://developers.google.com/maps/documentation/places/web-service/place-id
  // then use: https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID
  GOOGLE_REVIEW_URL: "https://g.page/r/CbPMHJX6veq6EBM/review",

  // Where the client-facing page lives. Leave blank to use mint-survey.html next to the results page.
  SURVEY_PAGE_URL: "",

  // Scores at or below this are flagged "needs a follow-up call".
  LOW_SCORE_THRESHOLD: 6,

  // OPTIONAL: email yourself the moment someone submits a low score (EmailJS, same account as your lead emails).
  // Template variables used: {{client}}, {{overall}}, {{recommend}}, {{improve}}, {{praise}}, {{to_email}}
  // Leave EMAILJS_TEMPLATE_ID blank to turn this off.
  EMAILJS_SERVICE_ID: "",
  EMAILJS_TEMPLATE_ID: "",
  EMAILJS_PUBLIC_KEY: "",
  ALERT_EMAIL: ""
};
