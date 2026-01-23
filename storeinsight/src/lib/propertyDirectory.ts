export type PropertyOption = {
  id: string;
  label: string;
  city: string;
};

export const PROPERTY_OPTIONS: PropertyOption[] = [
  { id: 'prop-pittman', label: 'STORE on Pittman', city: 'Fairfield, CA' },
  { id: 'L001', label: 'STORE on the Grove', city: 'Phoenix, AZ' },
];

export const getPropertyOption = (propertyId: string): PropertyOption => {
  const match = PROPERTY_OPTIONS.find((option) => option.id === propertyId);
  return match ?? { id: propertyId, label: propertyId, city: '' };
};
