/** Countries offered when saving a beneficiary at another bank. */
export const BENEFICIARY_COUNTRIES = [
  { code: "US", name: "Estados Unidos" },
  { code: "CA", name: "Canadá" },
  { code: "MX", name: "México" },
  { code: "ES", name: "España" },
  { code: "DE", name: "Alemania" },
  { code: "FR", name: "Francia" },
  { code: "GB", name: "Reino Unido" },
  { code: "BR", name: "Brasil" },
  { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
] as const;

/** "Spain" for "ES"; an unlisted code is shown as it is stored. */
export function countryName(code: string): string {
  return BENEFICIARY_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}
