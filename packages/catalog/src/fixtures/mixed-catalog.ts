/**
 * Hand-labelled mixed catalog for classifier evaluation. Titles imitate real
 * independent-store listings, including multilingual and accessory traps.
 * `eyewear` is the human label: is this a wearable frame we could try on?
 */
export const MIXED_CATALOG: {
  title: string;
  productType: string;
  tags: string[];
  category: string | null;
  eyewear: boolean;
}[] = [
  { title: "Milo Rectangular Acetate Frame - Black", productType: "Optical Frames", tags: ["optical"], category: null, eyewear: true },
  { title: "Riviera Polarized Sunglasses", productType: "Sunglasses", tags: [], category: "Apparel & Accessories > Clothing Accessories > Sunglasses", eyewear: true },
  { title: "Aviator Classic Gold", productType: "", tags: ["metal"], category: null, eyewear: true },
  { title: "Lunettes de vue Ronde Écaille", productType: "Lunettes", tags: [], category: null, eyewear: true },
  { title: "Gafas de sol Cuadradas", productType: "", tags: ["verano"], category: null, eyewear: true },
  { title: "Blue Light Glasses - Crystal", productType: "Eyewear", tags: [], category: null, eyewear: true },
  { title: "The Harper", productType: "Eyeglasses", tags: [], category: null, eyewear: true },
  { title: "The Nova", productType: "", tags: [], category: "Health & Beauty > Personal Care > Vision Care > Eyeglasses", eyewear: true },
  { title: "Wayfarer Tortoise 52-18-145", productType: "", tags: ["frames"], category: null, eyewear: true },
  { title: "Reading Glasses +1.5 Oval", productType: "Readers", tags: [], category: null, eyewear: true },
  { title: "Sonnenbrille Pilot", productType: "Brillen", tags: [], category: null, eyewear: true },
  { title: "نظارات شمسية كلاسيكية", productType: "", tags: [], category: null, eyewear: true },
  { title: "Cat-Eye Optical Frame Rose", productType: "Frames", tags: [], category: null, eyewear: true },
  { title: "Kids Round Glasses Blue", productType: "Kids", tags: [], category: null, eyewear: true },
  { title: "Monture Optique Titane", productType: "Optique", tags: [], category: null, eyewear: true },
  { title: "Hard Glasses Case - Black", productType: "Accessories", tags: ["glasses"], category: null, eyewear: false },
  { title: "Microfibre Lens Cleaning Cloth", productType: "Accessories", tags: ["eyewear"], category: null, eyewear: false },
  { title: "Sunglasses Chain Gold", productType: "Accessories", tags: ["sunglasses"], category: null, eyewear: false },
  { title: "Étui à lunettes cuir", productType: "Accessoires", tags: [], category: null, eyewear: false },
  { title: "Glasses Cleaning Spray 30ml", productType: "Care", tags: [], category: null, eyewear: false },
  { title: "Silicone Nose Pads (pair)", productType: "Spare parts", tags: ["glasses"], category: null, eyewear: false },
  { title: "Gift Card", productType: "Gift card", tags: [], category: null, eyewear: false },
  { title: "Linen Summer Shirt", productType: "Shirts", tags: ["summer"], category: "Apparel & Accessories > Clothing > Shirts", eyewear: false },
  { title: "Leather Belt Brown", productType: "Belts", tags: [], category: null, eyewear: false },
  { title: "Canvas Tote Bag", productType: "Bags", tags: [], category: null, eyewear: false },
  { title: "Daily Contact Lenses 30 pack", productType: "Contact lenses", tags: ["vision"], category: null, eyewear: false },
  { title: "Wool Beanie", productType: "Hats", tags: ["winter"], category: null, eyewear: false },
  { title: "Wine Glasses Set of 4", productType: "Kitchen", tags: ["glassware"], category: null, eyewear: false },
  { title: "Picture Frame 20x30", productType: "Home decor", tags: [], category: null, eyewear: false },
  { title: "Eyewear Retainer Cord", productType: "Accessories", tags: [], category: null, eyewear: false },
  { title: "Watch Steel Mesh", productType: "Watches", tags: [], category: null, eyewear: false },
  { title: "Bike Frame Aluminium", productType: "Bicycle parts", tags: [], category: null, eyewear: false },
];
