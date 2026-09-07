/**
 * City-by-city business licensing across Davis County.
 *
 * This is the part of compliance that catches online sellers, because nothing
 * about listing cards on eBay feels like it should involve city hall — and
 * because the answer genuinely differs from one city to the next. Kaysville and
 * Farmington do not require a licence for a qualifying home occupation.
 * Layton, West Point and Fruit Heights do, at no charge. Others charge, and
 * several publish fee schedules that could not be read at all.
 *
 * Davis County itself licenses only in UNINCORPORATED areas. If you are inside
 * any city, you deal with that city and not the county.
 *
 * Utah Code 17-53-216(4)(b) bars a county from charging a home-based business a
 * licence fee unless the business has offsite impact, and several cities apply
 * the same logic — which is why so many of these are free for a business that
 * nobody visits.
 *
 * Checked September 2026. Fees and ordinances change; anything marked
 * unverified could not be read from the city's own published schedule and needs
 * a phone call rather than a guess.
 */

export type LicenceRequirement =
  /** A licence is required for a home-based online reseller. */
  | 'required'
  /** Not required for a qualifying low-impact home occupation. */
  | 'exempt-if-low-impact'
  /** Required only in some circumstances; read the detail. */
  | 'conditional';

export interface CityLicensing {
  city: string;
  requirement: LicenceRequirement;
  /** What the city actually says. */
  summary: string;
  /** Fee for a low-impact home business, or null when it could not be confirmed. */
  homeBusinessFee: string | null;
  renewal: string | null;
  /** Rules a card reseller specifically needs to know about. */
  watchOut: string[];
  url: string;
  /** True when key facts came from the city's own page rather than a summary. */
  verified: boolean;
}

export const DAVIS_COUNTY_CITIES: CityLicensing[] = [
  {
    city: 'Layton',
    requirement: 'required',
    summary:
      'A licence is required for all businesses in the city, and the city defines "business" broadly. An online ' +
      'card reseller with nobody coming to the house is a low-impact home occupation.',
    homeBusinessFee: 'Free for low impact (nobody visits). $40 plus a $50 inspection if customers come to you.',
    renewal: 'Annual, one year from issue. The city emails reminders at 45, 30 and 15 days.',
    watchOut: ['The fee turns on offsite impact, so keep customers away from the house and it stays free.'],
    url: 'https://www.laytoncityutah.gov/LC/BusinessLicensing',
    verified: true,
  },
  {
    city: 'Bountiful',
    requirement: 'required',
    summary: 'All businesses operating in the city must have a licence. Applications are online only; paper is no longer accepted.',
    homeBusinessFee: null,
    renewal: 'Annual, calendar year. Licences expire 31 December.',
    watchOut: ['The fee schedule could not be read — the city moved domains and the old document is gone. Ask them.'],
    url: 'https://www.bountiful.gov/193/Business-Licensing',
    verified: true,
  },
  {
    city: 'Clearfield',
    requirement: 'required',
    summary: '"Home Based Business License" is one of the city\'s named licence categories, so home businesses are licensed.',
    homeBusinessFee: null,
    renewal: null,
    watchOut: ['No outdoor storage associated with the business.'],
    url: 'https://clearfield.city/business-development/',
    verified: true,
  },
  {
    city: 'Kaysville',
    requirement: 'exempt-if-low-impact',
    summary:
      'A licence is "no longer mandatory if specific guidelines are followed" for a Minor Home Occupation. You ' +
      'may still take one voluntarily. A Major Home Occupation does need one.',
    homeBusinessFee: 'Optional licence, about $30 processing.',
    renewal: 'Annual, by 31 December, if you hold one.',
    watchOut: [
      'Minor means operated entirely inside the home by the residents, with no outside employees and a capped floor area.',
      'Older city handouts say a licence is required. The current guidance says otherwise — confirm which applies.',
    ],
    url: 'https://www.kaysville.gov/183/Business-Licensing',
    verified: true,
  },
  {
    city: 'Farmington',
    requirement: 'exempt-if-low-impact',
    summary:
      'Home-based businesses are "not typically required" to hold a city licence. One can be obtained on request ' +
      'if you want the certificate.',
    homeBusinessFee: '$30 if you request one. $75 for impactful home occupations needing a fire inspection.',
    renewal: 'Annual, one year from issue.',
    watchOut: [
      'Must be conducted entirely within the home and not change the residential character of the property.',
      'The owner must live there and may not have employees who do not.',
    ],
    url: 'https://farmington.utah.gov/administration-department/business-licensing/',
    verified: true,
  },
  {
    city: 'Syracuse',
    requirement: 'exempt-if-low-impact',
    summary:
      'A licence is required for anyone doing business in the city "with the exception of a minor home ' +
      'occupation". A minor home occupation may request one and pay a processing fee.',
    homeBusinessFee: null,
    renewal: 'Annual, by 31 December.',
    watchOut: [
      'A major home occupation — anything with potential neighbourhood impact — may need Planning Commission approval.',
      'The fee schedule PDF could not be read; ask the city for the current figure.',
    ],
    url: 'https://syracuseut.gov/161/Business-Licensing',
    verified: true,
  },
  {
    city: 'Centerville',
    requirement: 'required',
    summary: 'A Home Occupation application is required for anyone operating a business from home, through the city portal.',
    homeBusinessFee: null,
    renewal: null,
    watchOut: [
      'The city lists only a short set of home occupations allowed WITHOUT Planning Commission approval. Check whether card resale is on it before assuming.',
    ],
    url: 'https://www.centervilleutah.gov/business-development/business-licenses-and-permits/',
    verified: true,
  },
  {
    city: 'North Salt Lake',
    requirement: 'conditional',
    summary:
      'A home business licence is generally required if your business address is your home here — but a state law ' +
      'exemption removes the requirement for qualifying home businesses. The city says so explicitly.',
    homeBusinessFee: 'Free if exempt. $25 a year if you want one anyway.',
    renewal: 'Annual.',
    watchOut: ['The zoning standards for home occupations still bind you even when the licence does not.'],
    url: 'https://www.nslcity.org/1018/Home-Business-Licenses',
    verified: true,
  },
  {
    city: 'Clinton',
    requirement: 'required',
    summary: 'Home occupations are licensed, with a dedicated fee line in the city fee schedule.',
    homeBusinessFee: null,
    renewal: 'Annual, calendar year. Expires 31 December.',
    watchOut: [
      'A fire safety inspection AND a building inspection must be completed before the licence is issued.',
      'If you rent, you need the property owner\'s consent.',
    ],
    url: 'https://www.clintoncity.net/2166/Business-License',
    verified: true,
  },
  {
    city: 'Woods Cross',
    requirement: 'required',
    summary: 'The city issues business licences and separately processes a Home Occupation Permit.',
    homeBusinessFee: null,
    renewal: 'Annual. The renewal window opens 15 November and runs to 31 December.',
    watchOut: ['Home occupations are allowed only in residential, mixed-use residential or agricultural zones.'],
    url: 'https://www.woodscross.gov/193/Business-Licensing',
    verified: true,
  },
  {
    city: 'West Point',
    requirement: 'required',
    summary: 'All home-based businesses must obtain a licence before operating. It is free but not transferable.',
    homeBusinessFee: 'Free. $25 penalty if renewed more than 15 days late. $75 for a conditional use permit if you need a major home occupation.',
    renewal: 'Annual.',
    watchOut: [
      'West Point publishes the most restrictive home occupation standards in the county. Read the application conditions before you rely on any of them.',
    ],
    url: 'https://www.westpointutah.gov/407/Home-Based-Business-License-Information',
    verified: true,
  },
  {
    city: 'Fruit Heights',
    requirement: 'required',
    summary:
      'Unusually explicit: if your business lists a Fruit Heights home as its physical location you need a ' +
      'licence, even if the business is not conducted in the city.',
    homeBusinessFee: 'Free for a low-impact home occupation.',
    renewal: 'Annual, on the anniversary of issue.',
    watchOut: ['A safety inspection is needed if anyone from the public comes to the house.'],
    url: 'https://www.fruitheights.gov/206/Business-Licensing',
    verified: true,
  },
  {
    city: 'South Weber',
    requirement: 'conditional',
    summary:
      'The fee schedule lists a charge only for "home occupations with patrons or employees", with no fee line ' +
      'for one without — which implies the quiet case is free, though the city does not say so outright.',
    homeBusinessFee: 'Free with no patrons or employees, apparently. $50 plus a fire inspection if you have them.',
    renewal: 'Annual. A 50% penalty applies to late fees.',
    watchOut: ['A home occupation stays classified as residential, so it does not flip your utility rates to commercial.'],
    url: 'https://southwebercity.gov/',
    verified: true,
  },
  {
    city: 'Sunset',
    requirement: 'required',
    summary:
      'It is unlawful to engage in business in the city without a licence, and the ordinance expressly covers ' +
      'temporary as well as permanent activity.',
    homeBusinessFee: null,
    renewal: 'Annual.',
    watchOut: ['"Temporary" is covered too, so a one-off table at a Sunset event is caught by the ordinance.'],
    url: 'https://sunsetut.gov/business-license/',
    verified: true,
  },
  {
    city: 'Unincorporated Davis County',
    requirement: 'required',
    summary:
      'The county licenses businesses only in unincorporated areas, and its ordinance makes it unlawful to trade ' +
      'there without one. Inside any city, you deal with the city instead.',
    homeBusinessFee:
      'State law bars the county from charging a home-based business a licence fee unless it has combined offsite impact.',
    renewal: 'Annual.',
    watchOut: [],
    url: 'https://www.daviscountyutah.gov/ced/planning',
    verified: true,
  },
];

export function licensingFor(city: string): CityLicensing | null {
  const needle = city.trim().toLowerCase();
  if (!needle) return null;
  return (
    DAVIS_COUNTY_CITIES.find((c) => c.city.toLowerCase() === needle) ??
    DAVIS_COUNTY_CITIES.find((c) => c.city.toLowerCase().includes(needle)) ??
    null
  );
}

/** Cities whose published fee could not be read and need a phone call. */
export function citiesNeedingConfirmation(): CityLicensing[] {
  return DAVIS_COUNTY_CITIES.filter((c) => c.homeBusinessFee === null);
}
