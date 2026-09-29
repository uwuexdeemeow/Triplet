import { LegalPage, useContactEmail, type LegalSection } from '@/components/legal-page';

// Public, like /terms: Google and Apple link to it from their sign-in screens.
// Keep it matching what the server actually does when features change.
export default function PrivacyScreen() {
  const contact = useContactEmail();
  const ask = contact ? `email ${contact}` : 'contact the person who invited you to Triplet';

  const sections: LegalSection[] = [
    {
      heading: 'What Triplet keeps',
      body: [
        [
          'Your account: your name, email address and, if you add one, a profile photo. Your password is only stored as a one-way hash, never as you typed it.',
          'If you sign in with Google, the name, email and Google account id Google shares with Triplet. Nothing else from your Google account.',
          'What you put into trips: trip details and destinations, plans, expenses, notes, the posts and screenshots you save, and the places found in them.',
          'Invitations: the email address of anyone you invite, even if they don’t have an account yet.',
          'For security, for a short time: counts of sign-in attempts, sign-ups and searches, with the network address or email they came from (kept at most 2 days), and sign-in sessions for your devices.',
        ],
        'Triplet has no ads and no analytics or tracking tools, and doesn’t sell or share your information for advertising.',
      ],
    },
    {
      heading: 'How it’s used',
      body: [
        'Only to run Triplet: to sign you in, show your trips to the people on them, find the places in the posts you save, suggest places and currencies, estimate costs, and email you sign-up codes, password resets and trip invitations.',
      ],
    },
    {
      heading: 'Services that handle it for Triplet',
      body: [
        'Triplet uses these services to do its job. Each gets only what that job needs:',
        [
          'Render (hosting) and Neon (database): store and serve everything above.',
          'Google Gemini (AI): reads the posts, screenshots and questions you send it, to find places and answer questions about your trip. Posts are downloaded from TikTok, Instagram or YouTube first.',
          'Brevo: sends Triplet’s emails, so it sees your email address and the message.',
          'OpenStreetMap services (Photon, Nominatim, OpenFreeMap map tiles): receive the place names you search for and show maps.',
          'Google Places, when it’s used for place details: receives the names of places to look up.',
          'Open-Meteo (weather) and Frankfurter (exchange rates): receive trip locations and currencies, not who you are.',
          'Google, if you choose Sign in with Google.',
        ],
      ],
    },
    {
      heading: 'Who can see your trips',
      body: [
        'Only the people you add to a trip, and anyone you give its guest code and PIN to. Other Triplet users can’t find your trips or your email address.',
      ],
    },
    {
      heading: 'Cookies',
      body: [
        'On the website, one cookie keeps you signed in. It can only be read by Triplet’s server, not by scripts on the page. There are no other cookies.',
      ],
    },
    {
      heading: 'Keeping and deleting it',
      body: [
        'Your information is kept while your account exists. You can delete your account at any time in Profile: that deletes your account, your photo, and trips only you are on. Trips shared with others stay for them, without your name.',
        'Encrypted backups of the database are kept for up to 30 days, so deleted information disappears from them within that time.',
        `To see what Triplet has about you, or for anything else about your information, ${ask}.`,
      ],
    },
    {
      heading: 'Children',
      body: ['Triplet isn’t meant for children under 13, and doesn’t knowingly collect their information.'],
    },
    {
      heading: 'Changes',
      body: ['If this policy changes, the new version will be on this page with a new date.'],
    },
  ];

  return (
    <LegalPage
      title="Privacy policy"
      updated="29 September 2026"
      intro="Triplet helps you and your friends plan trips from the posts you save. This page explains what it keeps about you, why, and who else handles it."
      sections={sections}
    />
  );
}
