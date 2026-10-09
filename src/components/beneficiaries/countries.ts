/** Countries offered when saving a beneficiary at another bank. */
export const BENEFICIARY_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "ES", name: "Spain" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
] as const;

/** "Spain" for "ES"; an unlisted code is shown as it is stored. */
export function countryName(code: string): string {
  return BENEFICIARY_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}
