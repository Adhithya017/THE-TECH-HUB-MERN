#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

// Load your Product model (which was exported as ESM default)
const ProductModule = require('../models/Product.js');
const Product = ProductModule.default || ProductModule;

const weaviateModule = require('weaviate-ts-client');
const weaviate = weaviateModule.default || weaviateModule;
const { ApiKey } = weaviateModule;

const {
  MONGO_URI,
  WEAVIATE_HOST,
  WEAVIATE_API_KEY
} = process.env;

if (!MONGO_URI || !WEAVIATE_HOST || !WEAVIATE_API_KEY) {
  console.error('❌ You must set MONGO_URI, WEAVIATE_HOST & WEAVIATE_API_KEY in .env');
  process.exit(1);
}

async function main() {
  // 1️⃣ Connect to MongoDB
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // 2️⃣ Connect to Weaviate
  const client = weaviate.client({
    scheme: 'https',
    host:   WEAVIATE_HOST,
    apiKey: new ApiKey(WEAVIATE_API_KEY),
  });

  // 3️⃣ Find products without a weaviateId
  const toSync = await Product.find({ weaviateId: { $exists: false } }).lean();
  console.log(`🔍 Found ${toSync.length} products to sync…`);

  for (const doc of toSync) {
    try {
      // 4️⃣ Lookup by name in Weaviate
      const resp = await client.graphql
        .get()
        .withClassName('Product')
        .withFields('_additional { id }')
        .withWhere({
          path: ['name'],
          operator: 'Equal',
          valueString: doc.name,
        })
        .withLimit(1)
        .do();

      const hits = resp.data.Get.Product;
      if (!hits.length) {
        console.warn(`⚠️  No Weaviate object found for name="${doc.name}"`);
        continue;
      }

      const wid = hits[0]._additional.id;
      // 5️⃣ Update Mongo document
      await Product.updateOne(
        { _id: doc._id },
        { $set: { weaviateId: wid } }
      );

      console.log(`✅ Synced "${doc.name}" → ${wid}`);
    } catch (err) {
      console.error(`❌ Error syncing "${doc.name}":`, err.message || err);
    }
  }

  console.log('🎉 Sync complete.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
