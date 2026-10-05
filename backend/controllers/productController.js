import Product from "../models/Product.js";

const trimText = (value) => String(value ?? "").trim();
const toNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const hasProductImage = ({ image_url, images } = {}) => {
  if (trimText(image_url)) return true;
  if (typeof images === "string") return Boolean(trimText(images));
  if (Array.isArray(images)) {
    return images.some((image) => trimText(typeof image === "string" ? image : image?.url));
  }
  if (images && typeof images === "object") {
    return Object.values(images).some((image) => trimText(image));
  }
  return false;
};
const validateProductPayload = (payload, existingProduct = null) => {
  const merged = existingProduct ? { ...existingProduct.toObject(), ...payload } : payload;
  const productName = trimText(merged.product_name || merged.name);
  const productType = trimText(merged.product_type);
  const category = trimText(merged.category);
  const pricingMethod = trimText(merged.pricing_method);
  const image_url = payload.image_url !== undefined ? payload.image_url : merged.image_url;
  const images = payload.images !== undefined ? payload.images : merged.images;

  if (!productName) return "Product name is required.";
  if (!productType) return "Product type is required.";
  if (!category) return "Category is required.";
  if (!hasProductImage({ image_url, images })) return "Main product photo is required.";
  if (!["sqft", "blade", "fixed", "per_piece"].includes(pricingMethod)) {
    return "A valid pricing method is required.";
  }

  if (pricingMethod === "sqft") {
    if (toNonNegativeNumber(merged.width) <= 0 || toNonNegativeNumber(merged.height) <= 0) {
      return "Width and height must be greater than 0.";
    }
    if (toNonNegativeNumber(merged.price_per_sqft) <= 0) {
      return "Price per sq ft is required.";
    }
  }

  if (pricingMethod === "blade") {
    if (toNonNegativeNumber(merged.blade_count) <= 0) {
      return "Blade count must be greater than 0.";
    }
    if (toNonNegativeNumber(merged.price_per_blade) <= 0) {
      return "Price per blade is required.";
    }
  }

  if ((pricingMethod === "fixed" || pricingMethod === "per_piece") && toNonNegativeNumber(merged.base_price || merged.unit_price) <= 0) {
    return "Base price is required for fixed price products.";
  }

  return "";
};

export const listProducts = async (req, res) => {
  try {
    const { search, category, adminOnly, featured } = req.query;
    const filter = {};

    // By default only show active products to non-admin (public) requests
    if (adminOnly !== "true") {
      filter.is_active = true;
    }

    if (featured === "true") {
      filter.is_featured = true;
    }

    if (category && category !== "all") {
      filter.category = category.toLowerCase();
    }

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [{ name: regex }, { sku: regex }, { description: regex }];
    }

    const products = await Product.find(filter).sort({ is_featured: -1, createdAt: -1 });
    res.json({ success: true, products });
  } catch (error) {
    console.error("List products error:", error);
    res.status(500).json({ success: false, message: "Unable to list products", error: error.message });
  }
};

export const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, product });
  } catch (error) {
    console.error("Get product error:", error);
    res.status(500).json({ success: false, message: "Unable to get product", error: error.message });
  }
};

export const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      description,
      unit_price,
      unit,
      measurement_unit,
      stock_quantity,
      image_url,
      // ERP fields
      product_type,
      product_name,
      pricing_method,
      variant,
      base_price,
      price_per_sqft,
      price_per_blade,
      customization_fee,
      standard_size,
      width,
      height,
      blade_count,
      estimated_area,
      estimated_price,
      estimated_price_override,
      images,
    } = req.body;

    const validationError = validateProductPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const categoryValue = String(category || "other").trim().toLowerCase();
    const productNameValue = trimText(product_name || name);

    const product = new Product({
      name: productNameValue,
      sku: sku || "",
      category: categoryValue,
      description: description || "",
      unit_price: Number(unit_price) || 0,
      unit: unit || "per_piece",
      measurement_unit: measurement_unit || "in",
      stock_quantity: Number(stock_quantity) || 0,
      is_featured: req.body.is_featured !== undefined ? Boolean(req.body.is_featured) : false,
      image_url: image_url || "",
      created_by: req.user?.id || undefined,
      // ERP fields
      product_type: trimText(product_type),
      product_name: productNameValue,
      pricing_method: pricing_method || "",
      variant: variant || "",
      base_price: Number(base_price) || 0,
      price_per_sqft: Number(price_per_sqft) || 0,
      price_per_blade: Number(price_per_blade) || 0,
      customization_fee: Number(customization_fee) || 0,
      standard_size: standard_size || "",
      width: Number(width) || 0,
      height: Number(height) || 0,
      blade_count: Number(blade_count) || 0,
      estimated_area: Number(estimated_area) || 0,
      estimated_price: Number(estimated_price) || 0,
      estimated_price_override: Number(estimated_price_override) || 0,
      images: images || {},
      is_active: req.body.is_active !== undefined ? Boolean(req.body.is_active) : true,
    });

    await product.save();
    res.status(201).json({ success: true, product });
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ success: false, message: "Unable to create product", error: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const validationError = validateProductPayload(req.body, product);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const updatedName = trimText(req.body.product_name ?? req.body.name ?? product.product_name ?? product.name);
    const updates = {
      name: updatedName,
      sku: req.body.sku ?? product.sku,
      category: String(req.body.category ?? product.category ?? "other").trim().toLowerCase(),
      description: req.body.description ?? product.description,
      unit_price: req.body.unit_price != null ? Number(req.body.unit_price) : product.unit_price,
      unit: req.body.unit ?? product.unit,
      measurement_unit: req.body.measurement_unit ?? product.measurement_unit,
      stock_quantity: req.body.stock_quantity != null ? Number(req.body.stock_quantity) : product.stock_quantity,
      is_featured: req.body.is_featured != null ? Boolean(req.body.is_featured) : product.is_featured,
      image_url: req.body.image_url ?? product.image_url,
      // ERP fields
      product_type: trimText(req.body.product_type ?? product.product_type),
      product_name: updatedName,
      pricing_method: req.body.pricing_method ?? product.pricing_method,
      variant: req.body.variant ?? product.variant,
      base_price: req.body.base_price != null ? Number(req.body.base_price) : product.base_price,
      price_per_sqft: req.body.price_per_sqft != null ? Number(req.body.price_per_sqft) : product.price_per_sqft,
      price_per_blade: req.body.price_per_blade != null ? Number(req.body.price_per_blade) : product.price_per_blade,
      customization_fee: req.body.customization_fee != null ? Number(req.body.customization_fee) : product.customization_fee,
      standard_size: req.body.standard_size != null ? String(req.body.standard_size) : product.standard_size,
      width: req.body.width != null ? Number(req.body.width) : product.width,
      height: req.body.height != null ? Number(req.body.height) : product.height,
      blade_count: req.body.blade_count != null ? Number(req.body.blade_count) : product.blade_count,
      estimated_area: req.body.estimated_area != null ? Number(req.body.estimated_area) : product.estimated_area,
      estimated_price: req.body.estimated_price != null ? Number(req.body.estimated_price) : product.estimated_price,
      estimated_price_override: req.body.estimated_price_override != null ? Number(req.body.estimated_price_override) : product.estimated_price_override || 0,
      images: req.body.images ?? product.images,
      is_active: req.body.is_active != null ? Boolean(req.body.is_active) : product.is_active,
    };

    Object.assign(product, updates);
    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ success: false, message: "Unable to update product", error: error.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await product.deleteOne();
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: "Unable to delete product", error: error.message });
  }
};
