// Shared mock catalog for menu.html and product.html.
// img: file in img/products/ (white-background copies of PRODUCTS/), or null for the "coming soon" placeholder.
// notes: [label, dot color]; dot colors come from the brand palette.
window.KASALO = (() => {
  const CATS = { coffee: 'Coffee', coolers: 'Coolers', pastries: 'Rice Cakes & Pastries' };
  const DOT = { banga: '#A84A2A', kalamansi: '#F2B732', jeepney: '#2456C8', sili: '#E8453F', tinta: '#141414', ube: '#5B3A8C' };

  // Default option groups per category. `add` raises the unit price; `mult` turns the line into a pack.
  const OPTIONS = {
    coffee: [
      { key: 'size', label: 'Size', choices: [{ label: '12 oz' }, { label: '16 oz', add: 20 }] },
      { key: 'milk', label: 'Milk', choices: [{ label: 'As served' }, { label: 'Oat', add: 20 }, { label: 'Coconut', add: 20 }] },
      { key: 'sweet', label: 'Sweetness', choices: [{ label: 'Regular' }, { label: 'Less sweet' }, { label: 'No sugar' }] },
    ],
    coolers: [
      { key: 'size', label: 'Size', choices: [{ label: '12 oz' }, { label: '16 oz', add: 20 }] },
      { key: 'sweet', label: 'Sweetness', choices: [{ label: 'Regular' }, { label: 'Less sweet' }] },
      { key: 'ice', label: 'Ice', choices: [{ label: 'Regular ice' }, { label: 'Light ice' }] },
    ],
    pastries: [
      { key: 'pack', label: 'Pack', choices: [{ label: 'Single' }, { label: 'Box of 4', mult: 4 }, { label: 'Box of 6', mult: 6 }] },
      { key: 'serve', label: 'Serve', choices: [{ label: 'As is' }, { label: 'Warmed' }] },
    ],
  };

  // Lifestyle shots shown after the product photo in the gallery.
  const GALLERY = {
    coffee: [['img/latte-pour.jpg', 'Latte art being poured at the bar'], ['img/cafe.jpg', 'Inside the Kasalo Kape café']],
    coolers: [['img/cup-holder-1.jpg', 'Kasalo Kape cups in a paper carrier'], ['img/cafe.jpg', 'Inside the Kasalo Kape café']],
    pastries: [['img/cafe.jpg', 'Inside the Kasalo Kape café'], ['img/cup-holder-4.jpg', 'Kasalo Kape cup carrier']],
  };

  const PRODUCTS = [
    { name: 'Barako Brusko', cat: 'coffee', price: 79, tags: ['Hot'], img: null,
      desc: 'Our boldest cup: Batangas Liberica brewed strong and served black, the way it has been poured in Lipa for generations. Big body, low acidity, and a smoky finish that wakes you right up.',
      notes: [['Dark chocolate', 'tinta'], ['Jackfruit', 'kalamansi'], ['Smoke', 'banga']] },
    { name: 'Kape Kastila', cat: 'coffee', price: 109, tags: ['Iced'], img: null,
      desc: 'A Spanish-style latte: espresso, milk, and a ribbon of condensed milk, shaken hard over ice. Creamy, sweet, and dangerously easy to finish.',
      notes: [['Condensed milk', 'kalamansi'], ['Toasted caramel', 'banga'], ['Cocoa', 'tinta']] },
    { name: 'Ube Ulap Latte', cat: 'coffee', price: 119, tags: ['Iced', 'Best Seller'], img: 'ube-latte.jpg',
      desc: 'Purple yam jam swirled into cold milk, topped with a shot of espresso and a soft cloud of ube cold foam. Our most photographed drink, and for good reason.',
      notes: [['Purple yam', 'ube'], ['Vanilla', 'kalamansi'], ['Espresso', 'tinta']] },
    { name: 'Batirol Mocha', cat: 'coffee', price: 119, tags: ['Hot'], img: null,
      desc: 'Tablea chocolate whisked the old way with a wooden batirol, then poured over a double shot. Thick, bittersweet, and warm to the bone.',
      notes: [['Tablea cacao', 'tinta'], ['Brown sugar', 'banga'], ['Cinnamon', 'sili']] },
    { name: 'Niyog Affogato Salo-Salo', cat: 'coffee', price: 129, tags: ['Seasonal'], img: 'coconut-affogato.jpg',
      desc: 'A scoop of toasted coconut ice cream drowned in a hot shot of espresso and finished with coconut caramel. Two spoons come with it, because it is meant for sharing.',
      notes: [['Toasted coconut', 'kalamansi'], ['Caramel', 'banga'], ['Espresso', 'tinta']],
      options: [{ key: 'scoop', label: 'Scoop', choices: [{ label: 'Single' }, { label: 'Double', add: 40 }] }] },

    { name: 'Arnibal Gold Slush', cat: 'coolers', price: 49, tags: ['Iced'], img: null,
      desc: 'Shaved ice, brown-sugar arnibal syrup, and a splash of fresh milk, blended into a golden slush. The sweetest ₱49 on Padre Faura.',
      notes: [['Brown sugar', 'banga'], ['Molasses', 'tinta'], ['Sweet cream', 'kalamansi']] },
    { name: 'Kalamansi Tanglad Fizz', cat: 'coolers', price: 69, tags: ['Iced', 'Best Seller'], img: 'kalamansi-fizz.jpg',
      desc: 'Freshly squeezed kalamansi and house lemongrass syrup, topped with sparkling water and a sprig of mint. Bright, tart, and built for Manila afternoons.',
      notes: [['Kalamansi', 'kalamansi'], ['Lemongrass', 'jeepney'], ['Mint', 'jeepney']] },
    { name: 'Melon Mestiza Chill', cat: 'coolers', price: 89, tags: ['Iced'], img: 'melon-smoothie.jpg',
      desc: 'Ripe cantaloupe blended with milk and ice: a creamy, grown-up take on the melon drink sold outside every school gate.',
      notes: [['Cantaloupe', 'kalamansi'], ['Fresh milk', 'jeepney'], ['Honey', 'banga']] },
    { name: 'Pandan Buko Frost', cat: 'coolers', price: 99, tags: ['Iced', 'Seasonal'], img: 'pandan-smoothie.jpg',
      desc: 'Pandan-infused young coconut blended with coconut milk and ice, finished with whipped cream. Cool, fragrant, and just sweet enough.',
      notes: [['Pandan', 'jeepney'], ['Young coconut', 'kalamansi'], ['Vanilla', 'banga']] },
    { name: 'Halo-Halo Ulap Frappe', cat: 'coolers', price: 129, tags: ['Iced', 'Seasonal'], img: null,
      desc: 'All the halo-halo favorites in one frappe: purple yam, leche flan, sweet beans, and toasted pinipig under a cloud of cream.',
      notes: [['Purple yam', 'ube'], ['Leche flan', 'kalamansi'], ['Toasted rice', 'banga']] },

    { name: 'Kutsinta', cat: 'pastries', price: 49, tags: ['Rice Cake'], img: null,
      desc: 'Chewy steamed rice cakes made with brown sugar, served with a generous heap of freshly grated coconut.',
      notes: [['Brown sugar', 'banga'], ['Grated coconut', 'kalamansi']] },
    { name: 'Pan Kastila Roll', cat: 'pastries', price: 49, tags: ['Pastry'], img: null,
      desc: 'Soft milk bread rolled around a buttery brown-sugar filling. Best warmed up and dunked straight into your coffee.',
      notes: [['Butter', 'kalamansi'], ['Brown sugar', 'banga']] },
    { name: 'Coco Pillow Bun', cat: 'pastries', price: 55, tags: ['Pastry'], img: null,
      desc: 'A pillowy milk bun stuffed with sweet shredded coconut and topped with toasted sesame seeds.',
      notes: [['Sweet coconut', 'kalamansi'], ['Toasted sesame', 'tinta'], ['Milk bread', 'banga']] },
    { name: 'Suman sa Lihiya', cat: 'pastries', price: 59, tags: ['Rice Cake'], img: 'suman.jpg',
      desc: 'Glutinous rice wrapped in banana leaves and slow-boiled until tender, served with coconut caramel for dipping.',
      notes: [['Banana leaf', 'jeepney'], ['Coconut caramel', 'banga']] },
    { name: 'Espasol', cat: 'pastries', price: 59, tags: ['Rice Cake'], img: 'espasol.jpg',
      desc: 'Soft rice-flour rolls cooked low and slow in coconut milk, then dusted in toasted rice flour. A Laguna classic.',
      notes: [['Toasted rice', 'banga'], ['Coconut milk', 'kalamansi']] },
    { name: 'Turon Crisp', cat: 'pastries', price: 69, tags: ['Pastry'], img: null,
      desc: 'Saba banana and ripe jackfruit wrapped in a thin spring-roll wrapper, fried crisp, and glazed in burnt caramel.',
      notes: [['Saba banana', 'kalamansi'], ['Jackfruit', 'kalamansi'], ['Caramel', 'banga']] },
    { name: 'Ensaymada Royale', cat: 'pastries', price: 79, tags: ['Pastry', 'Best Seller'], img: 'ensaymada.jpg',
      variants: [{ label: 'Classic', price: 79 }, { label: 'Ube', price: 89 }],
      desc: 'Brioche-soft coils brushed with butter, dusted with sugar, and buried under grated aged cheese. The ube version hides a layer of purple yam jam inside.',
      notes: [['Butter', 'kalamansi'], ['Aged cheese', 'banga'], ['Purple yam', 'ube']] },
    { name: 'Tablea Pinipig Brownie', cat: 'pastries', price: 99, tags: ['Pastry'], img: null,
      desc: 'A dense, fudgy brownie made with Batangas tablea chocolate and topped with crispy toasted pinipig.',
      notes: [['Dark chocolate', 'tinta'], ['Toasted rice', 'banga']] },
    { name: 'Bibingka Basque Cheesecake', cat: 'pastries', price: 189, note: 'Per slice', tags: ['Seasonal', 'Best Seller'], img: 'bibingka-basque.jpg',
      desc: 'Our holiday mash-up: a burnt Basque cheesecake baked in a banana-leaf lining with salted egg and coconut, the way bibingka is.',
      notes: [['Burnt caramel', 'banga'], ['Salted egg', 'kalamansi'], ['Banana leaf', 'jeepney']],
      options: [{ key: 'pack', label: 'Size', choices: [{ label: 'Slice' }, { label: 'Whole cake (8 slices)', mult: 8 }] }] },
  ].map((p, i) => ({ ...p, id: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), order: i, src: p.img && 'img/products/' + p.img }));

  // Option groups for one product: flavor variants first, then its own options or its category defaults.
  const optionsFor = p => [
    ...(p.variants ? [{ key: 'flavor', label: 'Flavor', choices: p.variants.map(v => ({ label: v.label, add: v.price - p.price })) }] : []),
    ...(p.options || OPTIONS[p.cat]),
  ];

  return {
    CATS, DOT, GALLERY, PRODUCTS, optionsFor,
    find: id => PRODUCTS.find(p => p.id === id),
    peso: n => '₱' + n.toLocaleString('en-PH'),
  };
})();
