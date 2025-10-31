export type OwnerFields = {
  CURRENTDATE: string;
  ADDRESS: string;
  OWNERGROUP: string;
  ACQUIREDDATE: string;
  TOTALUNITS: number;
  RENTABLESQFT: number;
  CURRENTMONTH: string;
  TOTALRENTALINCOME: number;
  TOTALINCOME: number;
  TOTALEXPENSES: number;
  NETINCOME: number;
  OCCUPIEDAREASQFT: number;
  OCCUPANCYBYUNITS: number;
  OCCUPIEDAREAPERCENT: number;
  MOVEINS_TODAY: number;
  MOVEINS_MTD: number;
  MOVEINS_YTD: number;
  MOVEOUTS_TODAY: number;
  MOVEOUTS_MTD: number;
  MOVEOUTS_YTD: number;
  NET_TODAY: number;
  NET_MTD: number;
  NET_YTD: number;
  MOVEINS_SQFT_MTD: number;
  MOVEOUTS_SQFT_MTD: number;
  NET_SQFT_MTD: number;
};

export const DEFAULT_OWNER_FIELDS: OwnerFields = {
  CURRENTDATE: "",
  ADDRESS: "",
  OWNERGROUP: "",
  ACQUIREDDATE: "",
  TOTALUNITS: 0,
  RENTABLESQFT: 0,
  CURRENTMONTH: "",
  TOTALRENTALINCOME: 0,
  TOTALINCOME: 0,
  TOTALEXPENSES: 0,
  NETINCOME: 0,
  OCCUPIEDAREASQFT: 0,
  OCCUPANCYBYUNITS: 0,
  OCCUPIEDAREAPERCENT: 0,
  MOVEINS_TODAY: 0,
  MOVEINS_MTD: 0,
  MOVEINS_YTD: 0,
  MOVEOUTS_TODAY: 0,
  MOVEOUTS_MTD: 0,
  MOVEOUTS_YTD: 0,
  NET_TODAY: 0,
  NET_MTD: 0,
  NET_YTD: 0,
  MOVEINS_SQFT_MTD: 0,
  MOVEOUTS_SQFT_MTD: 0,
  NET_SQFT_MTD: 0,
};

export const FIELD_LABELS: Record<keyof OwnerFields, string[]> = {
  CURRENTDATE: ["current date", "as of", "report date", "date"],
  ADDRESS: ["address", "property address", "site address"],
  OWNERGROUP: ["owners", "owner group", "ownership", "owner"],
  ACQUIREDDATE: ["management acquired date", "acquired date", "acquisition date"],
  TOTALUNITS: ["total units", "units total", "unit count"],
  RENTABLESQFT: ["rentable square feet", "rentable sqft", "rentable sq ft", "total rentable area"],
  CURRENTMONTH: ["current month", "report month", "month", "period month"],
  TOTALRENTALINCOME: ["total rental income", "rental income total", "total rental revenue", "rent income"],
  TOTALINCOME: ["total income", "gross income", "total revenue"],
  TOTALEXPENSES: ["total expenses", "operating expenses total", "total expense"],
  NETINCOME: ["net income", "noi", "net operating income"],
  OCCUPIEDAREASQFT: ["occupied area sqft", "occupied square feet", "occupied area", "occupied sf"],
  OCCUPANCYBYUNITS: ["occupancy by units", "occupied units", "units occupied"],
  OCCUPIEDAREAPERCENT: ["occupied area percent", "occupancy percent", "occupancy %", "occupied %"],
  MOVEINS_TODAY: ["move-ins today", "moveins today", "move-ins (today)"],
  MOVEINS_MTD: ["move-ins mtd", "moveins mtd", "move-ins month to date"],
  MOVEINS_YTD: ["move-ins ytd", "moveins ytd", "move-ins year to date"],
  MOVEOUTS_TODAY: ["move-outs today", "moveouts today", "move-outs (today)"],
  MOVEOUTS_MTD: ["move-outs mtd", "moveouts mtd", "move-outs month to date"],
  MOVEOUTS_YTD: ["move-outs ytd", "moveouts ytd", "move-outs year to date"],
  NET_TODAY: ["net today", "net move today"],
  NET_MTD: ["net mtd", "net month to date"],
  NET_YTD: ["net ytd", "net year to date"],
  MOVEINS_SQFT_MTD: ["move-ins sqft mtd", "moveins sqft mtd", "move-ins square feet mtd"],
  MOVEOUTS_SQFT_MTD: ["move-outs sqft mtd", "moveouts sqft mtd", "move-outs square feet mtd"],
  NET_SQFT_MTD: ["net sqft mtd", "net square feet mtd"],
};
