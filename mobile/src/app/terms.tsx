import { LegalPage, useContactEmail, type LegalSection } from '@/components/legal-page';

// Public, like /privacy: Google links to it from its sign-in screen.
export default function TermsScreen() {
  const contact = useContactEmail();

  const sections: LegalSection[] = [
    {
      heading: 'Using Triplet',
      body: [
        'Triplet is a free app for planning trips with friends. By making an account or using it, you agree to these terms and to the privacy policy.',
        'Keep your password to yourself. You’re responsible for what happens in your account, and for the trips and people you invite.',
      ],
    },
    {
      heading: 'What you save',
      body: [
        'The trips, notes, photos and posts you add stay yours. You let Triplet store and process them to run the app for you and the people on your trips, including sending saved posts and screenshots to its AI service to find the places in them.',
        'Only save posts and images you’re allowed to share. The posts themselves belong to the people who made them; Triplet shows a link back to the original.',
      ],
    },
    {
      heading: 'Fair use',
      body: [
        'Don’t use Triplet to break the law, harass people, send spam, or try to get into accounts or data that aren’t yours, and don’t overload it on purpose. There are daily limits on things like saving posts, so the free service stays usable for everyone.',
        'Accounts that break these rules may be suspended or removed.',
      ],
    },
    {
      heading: 'No guarantees',
      body: [
        'Places, addresses, opening hours, prices, weather and exchange rates come from AI and public data, and can be wrong or out of date. Check anything important, like bookings, opening times and travel rules, before you rely on it.',
        'Triplet is provided as it is, may change, and may sometimes be unavailable. As far as the law allows, Triplet isn’t responsible for losses from using it or from its information being wrong.',
      ],
    },
    {
      heading: 'Ending',
      body: [
        'You can delete your account at any time in Profile. If these terms change, the new version will be on this page with a new date, and using Triplet after that means you accept it.',
        ...(contact ? [`Questions: ${contact}.`] : []),
      ],
    },
  ];

  return (
    <LegalPage
      title="Terms"
      updated="29 September 2026"
      intro="The short version: use Triplet to plan trips, be kind, only save what you’re allowed to, and double-check anything important."
      sections={sections}
    />
  );
}
