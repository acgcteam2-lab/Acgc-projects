import mongoose from "mongoose";
import CatalogItem from "../models/CatalogItem.js";
import Product from "../models/Product.js";

const findCatalogItem = async (identifier, kind) => {
  if (!identifier) return null;
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const byId = await CatalogItem.findById(identifier);
    if (byId) return byId;
  }
  const filter = { kind, name: identifier };
  const byName = await CatalogItem.findOne(filter);
  return byName;
};

const mapNamesByType = (items) => {
  const map = {};
  items.forEach((it) => {
    const t = it.meta?.product_type || it.meta?.type || it.meta?.productType || it.meta?.category || "";
    if (!map[t]) map[t] = [];
    map[t].push({ id: it._id, name: it.name, product_type: t });
  });
  return map;
};

const mapVariantsByType = (variants, names, products) => {
  const map = {};
  const typesByName = new Map();
  const addTypeMapping = (productName, productType) => {
    const name = String(productName || "").trim().toLowerCase();
    const type = String(productType || "").trim();
    if (!name || !type) return;
    const types = typesByName.get(name) || new Set();
    types.add(type);
    typesByName.set(name, types);
  };

  names.forEach((item) => addTypeMapping(item.name, item.meta?.product_type));
  products.forEach((product) => addTypeMapping(product.product_name || product.name, product.product_type));

  variants.forEach((item) => {
    const productName = item.meta?.product_name || item.meta?.name || "";
    const productTypes = item.meta?.product_type
      ? [String(item.meta.product_type).trim()]
      : [...(typesByName.get(String(productName).trim().toLowerCase()) || [])];
    productTypes.filter(Boolean).forEach((productType) => {
      if (!map[productType]) map[productType] = [];
      map[productType].push({ id: item._id, name: item.name, product_type: productType });
    });
  });
  return map;
};

export const getTypes = async (req, res) => {
  try {
    const types = await CatalogItem.find({ kind: "type" }).sort({ name: 1 });
    res.json(types.map((t) => ({ id: t._id, name: t.name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to fetch types" });
  }
};

export const createType = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    const exists = await CatalogItem.findOne({ kind: "type", name });
    if (exists) return res.status(409).json({ success: false, message: "Type already exists" });
    const item = new CatalogItem({ kind: "type", name, created_by: req.user?.id });
    await item.save();
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to create type" });
  }
};

export const updateType = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "type");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const previousName = item.name;
    const nextName = String(req.body.name || "").trim();
    if (!nextName) return res.status(400).json({ success: false, message: "Name is required" });
    const duplicate = await CatalogItem.findOne({ kind: "type", name: nextName, _id: { $ne: item._id } });
    if (duplicate) return res.status(409).json({ success: false, message: "Type already exists" });
    item.name = nextName;
    await item.save();
    if (previousName !== nextName) {
      await Promise.all([
        Product.updateMany({ product_type: previousName }, { $set: { product_type: nextName } }),
        CatalogItem.updateMany({ kind: "name", "meta.product_type": previousName }, { $set: { "meta.product_type": nextName } }),
        CatalogItem.updateMany({ kind: "variant", "meta.product_type": previousName }, { $set: { "meta.product_type": nextName } }),
      ]);
    }
    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to update type" });
  }
};

export const deleteType = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "type");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const [productCount, nameCount, variantCount] = await Promise.all([
      Product.countDocuments({ product_type: item.name }),
      CatalogItem.countDocuments({ kind: "name", "meta.product_type": item.name }),
      CatalogItem.countDocuments({ kind: "variant", "meta.product_type": item.name }),
    ]);
    const count = productCount + nameCount + variantCount;
    if (count > 0) return res.status(400).json({ success: false, message: "Item in use", count });
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to delete type" });
  }
};

export const getNames = async (req, res) => {
  try {
    const names = await CatalogItem.find({ kind: "name" }).sort({ name: 1 });
    const map = mapNamesByType(names);
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to fetch names" });
  }
};

export const createName = async (req, res) => {
  try {
    const { name, product_type } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    const exists = await CatalogItem.findOne({ kind: "name", name, "meta.product_type": product_type });
    if (exists) return res.status(409).json({ success: false, message: "Name already exists for this type" });
    const item = new CatalogItem({ kind: "name", name, meta: { product_type }, created_by: req.user?.id });
    await item.save();
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to create name" });
  }
};

export const updateName = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "name");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    item.name = req.body.name || item.name;
    if (req.body.product_type) item.meta = { ...item.meta, product_type: req.body.product_type };
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to update name" });
  }
};

export const deleteName = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "name");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const count = await Product.countDocuments({ product_name: item.name });
    if (count > 0) return res.status(400).json({ success: false, message: "Item in use", count });
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to delete name" });
  }
};

export const getVariants = async (req, res) => {
  try {
    const [variants, names, products] = await Promise.all([
      CatalogItem.find({ kind: "variant" }).sort({ name: 1 }).lean(),
      CatalogItem.find({ kind: "name" }).select("name meta").lean(),
      Product.find({}).select("name product_name product_type").lean(),
    ]);
    const map = mapVariantsByType(variants, names, products);
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to fetch variants" });
  }
};

export const createVariant = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const productType = String(req.body.product_type || "").trim();
    if (!name || !productType) return res.status(400).json({ success: false, message: "Name and product_type are required" });
    const exists = await CatalogItem.findOne({ kind: "variant", name, "meta.product_type": productType });
    if (exists) return res.status(409).json({ success: false, message: "Variant already exists for this product type" });
    const item = new CatalogItem({ kind: "variant", name, meta: { product_type: productType }, created_by: req.user?.id });
    await item.save();
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to create variant" });
  }
};

export const updateVariant = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "variant");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const previousName = item.name;
    const nextName = String(req.body.name || "").trim();
    const productType = String(req.body.product_type || item.meta?.product_type || "").trim();
    if (!nextName || !productType) return res.status(400).json({ success: false, message: "Name and product_type are required" });
    const duplicate = await CatalogItem.findOne({ kind: "variant", name: nextName, "meta.product_type": productType, _id: { $ne: item._id } });
    if (duplicate) return res.status(409).json({ success: false, message: "Variant already exists for this product type" });
    item.name = nextName;
    item.meta = { ...item.meta, product_type: productType };
    await item.save();
    if (previousName !== nextName) {
      await Product.updateMany({ variant: previousName, product_type: productType }, { $set: { variant: nextName } });
    }
    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to update variant" });
  }
};

export const deleteVariant = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "variant");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const requestedType = String(req.query.product_type || "").trim();
    const productType = requestedType || item.meta?.product_type || "";
    const count = await Product.countDocuments({
      variant: item.name,
      ...(productType ? { product_type: productType } : {}),
    });
    if (count > 0) return res.status(400).json({ success: false, message: "Item in use", count });
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to delete variant" });
  }
};

export const getCategories = async (req, res) => {
  try {
    const categories = await CatalogItem.find({ kind: "category" }).sort({ name: 1 });
    res.json(categories.map((c) => ({ id: c._id, name: c.name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to fetch categories" });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    const exists = await CatalogItem.findOne({ kind: "category", name });
    if (exists) return res.status(409).json({ success: false, message: "Category already exists" });
    const item = new CatalogItem({ kind: "category", name, created_by: req.user?.id });
    await item.save();
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to create category" });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "category");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const previousName = item.name;
    const nextName = String(req.body.name || "").trim();
    if (!nextName) return res.status(400).json({ success: false, message: "Name is required" });
    const duplicate = await CatalogItem.findOne({ kind: "category", name: nextName, _id: { $ne: item._id } });
    if (duplicate) return res.status(409).json({ success: false, message: "Category already exists" });
    item.name = nextName;
    await item.save();
    if (previousName !== nextName) {
      await Product.updateMany({ category: previousName.toLowerCase() }, { $set: { category: nextName.toLowerCase() } });
    }
    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to update category" });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const item = await findCatalogItem(req.params.id, "category");
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    const count = await Product.countDocuments({ category: item.name.toLowerCase() });
    if (count > 0) return res.status(400).json({ success: false, message: "Item in use", count });
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to delete category" });
  }
};

export const checkUsage = async (req, res) => {
  try {
    const { kind, id } = req.params;
    const item = await CatalogItem.findById(id);
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    let count = 0;
    if (kind === "types" || item.kind === "type") {
      const [productCount, nameCount, variantCount] = await Promise.all([
        Product.countDocuments({ product_type: item.name }),
        CatalogItem.countDocuments({ kind: "name", "meta.product_type": item.name }),
        CatalogItem.countDocuments({ kind: "variant", "meta.product_type": item.name }),
      ]);
      count = productCount + nameCount + variantCount;
    } else if (kind === "names" || item.kind === "name") {
      count = await Product.countDocuments({ product_name: item.name });
    } else if (kind === "variants" || item.kind === "variant") {
      count = await Product.countDocuments({
        variant: item.name,
        ...(item.meta?.product_type ? { product_type: item.meta.product_type } : {}),
      });
    } else if (kind === "categories" || item.kind === "category") {
      count = await Product.countDocuments({ category: item.name.toLowerCase() });
    } else {
      count = 0;
    }
    res.json({ success: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unable to check usage" });
  }
};
