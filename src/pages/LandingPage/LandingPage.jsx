import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  X,
  ArrowRight,
  ShoppingBag,
  Search,
  Package,
  BriefcaseBusiness,
  ShieldCheck,
  Clock3,
  Wrench,
  Truck,
  Ruler,
  LoaderCircle,
  Star,
  StarHalf,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
} from "lucide-react";
import OrderProgressTimeline from "@/components/OrderProgressTimeline";
import ProductPriceEstimator from "@/components/ProductPriceEstimator";
import { getPaymentSummary } from "@/pages/Transactions/paymentProofUtils";
import { getProducts } from "../../api/products";
import { getProductReviewSummary, trackOrder } from "../../api/orders";
import logo from "../../assets/images/ACGCLOGO1.png";
import { calculateEstimate } from "@/lib/estimator";
import { getFinalProjectCost } from "@/lib/orderPricing";
import { resolveBackendImageUrl } from "../../lib/resolveBackendImageUrl";
import { getDefaultProductLineTotal, getProductLineTotal } from "../../lib/productPricing";
import { useIsMobile } from "@/hooks/useIsMobile";

function LandingPage() {
  const isMobile = useIsMobile();
  const [active, setActive] = useState("home");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productEstimatorForm, setProductEstimatorForm] = useState({ unit: "in", width: "0", height: "0", blade_glass_type: "", sale_mode: "blades_only", frame_type: "", custom_frame_size: false, blade_count: 1 });
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("All");
  const [productType, setProductType] = useState("All");
  const [productPage, setProductPage] = useState(1);
  const [productsPerPage, setProductsPerPage] = useState(8);
  const [featuredProductStats, setFeaturedProductStats] = useState({});
  const [featuredRatingStats, setFeaturedRatingStats] = useState({
    average: 0,
    total: 0,
    counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);
  const [featuredError, setFeaturedError] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState(null);
  const [trackingError, setTrackingError] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [showAllTrackedItems, setShowAllTrackedItems] = useState(false);
  const trackingPaymentSummary = trackingResult ? getPaymentSummary(trackingResult) : null;
  const scrollToSection = (sectionId) => {
    setActive(sectionId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const isBladeProduct = (product) => ["blade", "per_blade"].includes(
    String(product?.pricing_method || product?.unit || "").toLowerCase()
  );

  const getDefaultBladeSelections = (product) => {
    const glassTypes = Array.isArray(product?.blade_glass_types) ? product.blade_glass_types : [];
    const frameTypes = Array.isArray(product?.blade_frame_types) ? product.blade_frame_types : [];
    const defaultFrame = frameTypes.find((frame) => frame.name === product?.default_frame_type) || frameTypes[0];
    const sellBladesOnly = product?.sell_blades_only !== false;
    const defaultSaleMode = product?.default_sale_mode || (sellBladesOnly ? "blades_only" : "frame");
    const saleMode = defaultSaleMode === "frame" && !product?.sell_with_frame ? "blades_only" : defaultSaleMode;

    const defaultBladeCount = saleMode === "frame"
      ? Number(defaultFrame?.blade_count) || Number(product?.minimum_blades) || 1
      : Number(product?.minimum_blades) || Number(product?.blade_count) || 1;

    return {
      blade_glass_type: product?.default_blade_glass_type || glassTypes[0]?.name || "",
      sale_mode: saleMode,
      frame_type: defaultFrame?.name || "",
      custom_frame_size: saleMode === "frame" && frameTypes.length === 0 && Boolean(product?.allow_custom_frame_size),
      blade_count: product?.customer_can_choose_blade_count ? "" : defaultBladeCount,
    };
  };

  const openProductDetails = (product) => {
    setSelectedProduct(product);
    setProductEstimatorForm({ unit: "in", width: "0", height: "0", ...getDefaultBladeSelections(product) });
  };

  useEffect(() => {
    const loadFeaturedProducts = async () => {
      setIsLoadingFeatured(true);
      setFeaturedError("");

      try {
        const response = await getProducts();
        const activeProducts = (response.products || []).filter((product) => product.is_active !== false);

        const productReviewData = await Promise.all(
          activeProducts.map(async (product) => {
            try {
              const reviewResponse = await getProductReviewSummary(product._id || product.id);

              return {
                product,
                averageRating: Number(reviewResponse.average) || 0,
                ratingsCount: Number(reviewResponse.total) || 0,
                ratingCounts: reviewResponse.counts || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
              };
            } catch {
              return {
                product,
                averageRating: 0,
                ratingsCount: 0,
                ratingCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
              };
            }
          })
        );

        const stats = {};
        const sortedProducts = productReviewData
          .sort((a, b) => {
            if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
            return b.ratingsCount - a.ratingsCount;
          })
          .map(({ product, averageRating, ratingsCount }) => {
            stats[product._id || product.id] = { averageRating, ratingsCount };
            return product;
          });

        const totalRatings = productReviewData.reduce((sum, entry) => sum + entry.ratingsCount, 0);
        const ratingCounts = productReviewData.reduce((counts, entry) => {
          [5, 4, 3, 2, 1].forEach((star) => {
            counts[star] += entry.ratingCounts?.[star] || 0;
          });
          return counts;
        }, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
        const weightedRatingTotal = [5, 4, 3, 2, 1].reduce(
          (sum, star) => sum + ratingCounts[star] * star,
          0
        );

        setCatalogProducts(activeProducts);
        setFeaturedProducts(sortedProducts.slice(0, 3));
        setFeaturedProductStats(stats);
        setFeaturedRatingStats({
          average: totalRatings ? weightedRatingTotal / totalRatings : 0,
          total: totalRatings,
          counts: ratingCounts,
        });
      } catch (error) {
        console.error("Failed to load featured products", error);
        setCatalogProducts([]);
        setFeaturedProducts([]);
        setFeaturedProductStats({});
        setFeaturedRatingStats({ average: 0, total: 0, counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
        setFeaturedError(
          error?.data?.message || error?.message || "Failed to load featured products."
        );
      } finally {
        setIsLoadingFeatured(false);
      }
    };

    loadFeaturedProducts();
  }, []);

  useEffect(() => {
    if (!selectedProduct) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelectedProduct(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedProduct]);

  const isLocalBlobOrFile = (url) =>
    typeof url === "string" && (url.startsWith("blob:") || url.startsWith("file:"));

  const getProductImage = (product) => {
    if (!product) return "";
    const imageCandidates = [product.image_url, product.image];
    if (Array.isArray(product.images) && product.images.length > 0) {
      imageCandidates.push(product.images[0]);
    }
    if (product.images && typeof product.images === "object") {
      const images = Object.values(product.images).flat().filter(Boolean);
      if (images.length > 0) imageCandidates.push(images[0]);
    }

    for (const candidate of imageCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        if (!isLocalBlobOrFile(candidate)) {
          return resolveBackendImageUrl(candidate);
        }
      }
    }

    return "";
  };

  const getProductDefaultDimensions = (product) => {
    const dimensionText = String(product?.dimensions || product?.standard_size || product?.size || "");
    const dimensionMatch = dimensionText.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)/i);
    const unitMatch = dimensionText.match(/\b(cm|mm|m|ft|in|inch|inches|feet|meter|meters)\b|"/i);
    const unitMap = { inch: "in", inches: "in", feet: "ft", meter: "m", meters: "m" };

    return {
      width: Number(product?.width) > 0 ? Number(product.width) : dimensionMatch ? Number(dimensionMatch[1]) : 0,
      height: Number(product?.height) > 0 ? Number(product.height) : dimensionMatch ? Number(dimensionMatch[2]) : 0,
      unit: product?.measurement_unit || product?.measurementUnit || (
        unitMatch ? unitMap[unitMatch[1]?.toLowerCase()] || unitMatch[1]?.toLowerCase() || "in" : "in"
      ),
      quantity: 1,
      customized: false,
    };
  };

  const getProductPrice = (product) => {
    if (!product) return "Contact us";
    if (isBladeProduct(product)) {
      const defaultPrice = getDefaultProductLineTotal(product);
      return defaultPrice > 0
        ? `₱${defaultPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Contact us";
    }
    const override = Number(product.estimated_price_override) || 0;
    if (override > 0) {
      const defaultPrice = getProductLineTotal(product, getProductDefaultDimensions(product));
      return `₱${defaultPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (isBladeProduct(product) && product.show_price_per_blade !== false) {
      const glassRates = (product.blade_glass_types || [])
        .map((glass) => Number(glass.price_per_blade) || 0)
        .filter((price) => price > 0);
      const bladeRate = glassRates.length
        ? Math.min(...glassRates)
        : Number(product.price_per_blade || product.unit_price) || 0;
      if (bladeRate > 0) {
        return `₱${bladeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / blade`;
      }
    }
    const price = getProductLineTotal(product, getProductDefaultDimensions(product));
    return price > 0
      ? `₱${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "Contact us";
  };

  const getProductUnitRate = (product) => {
    const pricePerSqft = Number(product.price_per_sqft) || 0;
    const pricePerBlade = Number(product.price_per_blade) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    const unitKey = product.unit || product.pricing_method || "unit";
    const unitLabels = {
      per_sqft: "sq ft",
      sqft: "sq ft",
      per_blade: "blade",
      blade: "blade",
      per_piece: "piece",
      piece: "piece",
      per_meter: "meter",
      meter: "meter",
      per_set: "set",
      set: "set",
    };
    const label = unitLabels[unitKey] || unitKey;

    if (isBladeProduct(product)) {
      if (product.show_price_per_blade === false) return `Starting from ${getProductPrice(product)}`;
      const glassRates = (product.blade_glass_types || [])
        .map((glass) => Number(glass.price_per_blade) || 0)
        .filter((price) => price > 0);
      const bladeRate = glassRates.length ? Math.min(...glassRates) : pricePerBlade || unitPrice;
      if (bladeRate > 0) return `₱${bladeRate.toLocaleString()} / blade`;
    }

    if ((product.pricing_method === "sqft" || label === "sq ft") && pricePerSqft > 0) {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if ((product.pricing_method === "blade" || label === "blade") && pricePerBlade > 0) {
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (unitPrice > 0) return `₱${unitPrice.toLocaleString()} / ${label}`;
    return "Contact us";
  };

  const getProductEstimateRate = (product) => {
    const pricingMethod = String(product?.pricing_method || "").toLowerCase();
    const legacyUnit = String(product?.unit || "").toLowerCase();
    if (pricingMethod === "sqft" || (!pricingMethod && ["per_sqft", "sqft"].includes(legacyUnit))) {
      return Number(product?.price_per_sqft) || undefined;
    }
    if (isBladeProduct(product)) {
      const selectedGlass = (product?.blade_glass_types || []).find(
        (glass) => glass.name === productEstimatorForm.blade_glass_type
      );
      return Number(selectedGlass?.price_per_blade ?? product?.price_per_blade) || undefined;
    }
    return undefined;
  };

  const productCategoryOptions = [...new Set(catalogProducts
    .map((product) => String(product.category || "").trim())
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const productTypeOptions = [...new Set(catalogProducts
    .map((product) => String(product.product_type || product.type || "").trim())
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const visibleProducts = catalogProducts.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    const matchesSearch = !query || `${product.name || ""} ${product.product_name || ""} ${product.product_type || ""} ${product.category || ""} ${product.description || ""}`
      .toLowerCase().includes(query);
    const matchesCategory = productCategory === "All" || String(product.category || "").toLowerCase() === productCategory.toLowerCase();
    const matchesType = productType === "All" || String(product.product_type || product.type || "").toLowerCase() === productType.toLowerCase();
    return matchesSearch && matchesCategory && matchesType;
  });
  const productPageCount = Math.max(1, Math.ceil(visibleProducts.length / productsPerPage));
  const currentProductPage = Math.min(productPage, productPageCount);
  const productPageStart = (currentProductPage - 1) * productsPerPage;
  const pagedProducts = visibleProducts.slice(productPageStart, productPageStart + productsPerPage);
  const displayedProducts = isMobile ? visibleProducts : pagedProducts;
  const productEstimatorWidth = Number(productEstimatorForm.width) || 0;
  const productEstimatorHeight = Number(productEstimatorForm.height) || 0;
  const selectedProductFrame = (selectedProduct?.blade_frame_types || []).find((frame) => frame.name === productEstimatorForm.frame_type);
  const productBladeMinimum = Math.max(1, Number(selectedProduct?.minimum_blades) || 1);
  const productBladeMaximum = Number(selectedProduct?.maximum_blades) || 0;
  const selectedFrameBladeCount = Number(selectedProductFrame?.blade_count) || 0;
  const bladeCountMinimum = productEstimatorForm.sale_mode === "frame" && !productEstimatorForm.custom_frame_size && selectedFrameBladeCount > 0
    ? selectedFrameBladeCount
    : productBladeMinimum;
  const effectiveBladeCount = Number(productEstimatorForm.blade_count) || bladeCountMinimum;
  const rawProductEstimatorResult = selectedProduct ? calculateEstimate({
    productName: selectedProduct.product_name || selectedProduct.name,
    categoryKey: selectedProduct.product_type || selectedProduct.category,
    variantName: selectedProduct.variant,
    width: productEstimatorWidth,
    height: productEstimatorHeight,
    measurementUnit: productEstimatorForm.unit,
    quantity: 1,
    blade_count: isBladeProduct(selectedProduct) ? effectiveBladeCount : selectedProduct.blade_count || 0,
    base_price: selectedProduct.base_price || undefined,
    overrideRate: getProductEstimateRate(selectedProduct),
    customization: selectedProduct.customization || false,
    customization_fee: selectedProduct.customization_fee || 0,
  }) : null;
  const productEstimatorResult = selectedProduct
    ? isBladeProduct(selectedProduct)
      ? {
          estimated_price: getProductLineTotal(selectedProduct, {
            ...productEstimatorForm,
            quantity: 1,
            blade_count: effectiveBladeCount,
          }),
          rate: getProductEstimateRate(selectedProduct),
          areaDisplay: `${effectiveBladeCount} blade${effectiveBladeCount === 1 ? "" : "s"}`,
        }
      : {
          ...rawProductEstimatorResult,
          estimated_price: getProductLineTotal(selectedProduct, {
            width: productEstimatorWidth,
            height: productEstimatorHeight,
            measurement_unit: productEstimatorForm.unit,
            quantity: 1,
            customized: true,
          }),
        }
    : null;
  const selectedProductRating = selectedProduct
    ? featuredProductStats[selectedProduct._id || selectedProduct.id] || { averageRating: 0, ratingsCount: 0 }
    : { averageRating: 0, ratingsCount: 0 };

  const handleTrackOrder = async (event) => {
    event.preventDefault();
    const tracking = trackingNumber.trim();
    if (!tracking) {
      setTrackingError("Please enter your tracking number.");
      setTrackingResult(null);
      return;
    }

    setTrackingLoading(true);
    setTrackingError("");
    setTrackingResult(null);
    setShowAllTrackedItems(false);
    try {
      const response = await trackOrder(tracking);
      setTrackingResult(response.order || response);
    } catch (error) {
      setTrackingError(error.data?.message || error.message || "No order found with that tracking number.");
    } finally {
      setTrackingLoading(false);
    }
  };

  const statusLabel = (status) => String(status || "Unknown").replace(/_/g, " ");

  const getStatusBadgeClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("complete") || normalized === "delivered") return "border-emerald-300 bg-emerald-50 text-emerald-800";
    if (normalized.includes("cancel") || normalized.includes("declin") || normalized.includes("reject")) return "border-rose-300 bg-rose-50 text-rose-800";
    if (normalized.includes("process") || normalized.includes("install")) return "border-sky-300 bg-sky-50 text-sky-800";
    return "border-amber-300 bg-amber-50 text-amber-900";
  };

  const getStatusBadgeIcon = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("complete") || normalized === "delivered") return CircleCheck;
    if (normalized.includes("cancel") || normalized.includes("declin") || normalized.includes("reject")) return CircleX;
    return CircleAlert;
  };

  const formatCurrency = (value) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDateText = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getOrderCustomerName = (order) => {
    if (!order) return "—";
    if (order.customer_name) return order.customer_name;
    const customer = order.customer || {};
    return `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "—";
  };

  const getOrderShippingAddress = (order) => {
    if (!order) return "—";
    const shippingAddress = order.shipping_address || order.customer?.shipping_address;
    if (typeof shippingAddress === "string" && shippingAddress.trim()) return shippingAddress.trim();

    const shipping = shippingAddress && typeof shippingAddress === "object" ? shippingAddress : {};
    const addressParts = [
      shipping.street_address || shipping.street || shipping.address_line || shipping.line1,
      shipping.city,
      shipping.province || shipping.state,
      shipping.zip_code || shipping.postal_code,
    ].filter(Boolean);

    if (addressParts.length > 0) return addressParts.join(", ");
    const customer = order.customer || {};
    const customerAddress = [customer.street_address, customer.city, customer.province, customer.zip_code]
      .filter(Boolean)
      .join(", ");
    return customerAddress || "—";
  };

  const getTrackedItemAmount = (item) => {
    const savedLineTotal = Number(item?.line_total);
    if (savedLineTotal > 0) return savedLineTotal;

    const legacyTotal = Number(item?.total_amount || item?.amount);
    if (legacyTotal > 0) return legacyTotal;

    if (item?.is_estimate) {
      const estimatedTotal = Number(item.estimated_price || item.manual_estimated_total || 0);
      if (estimatedTotal > 0) return estimatedTotal;
    }

    const quantity = Math.max(1, Number(item?.quantity || item?.qty) || 1);
    const area = Number(item?.area || item?.dimensions?.area || 0);
    const pricePerSqft = Number(
      item?.price_per_sqft || item?.product_id?.price_per_sqft || item?.product?.price_per_sqft || 0
    );
    if (area > 0 && pricePerSqft > 0) return area * pricePerSqft;

    const unitPrice = Number(
      item?.unit_price || item?.product_id?.unit_price || item?.product?.unit_price || 0
    );
    return unitPrice * quantity;
  };

  const renderRatingStars = (rating = 0, size = 16) => {
    const normalizedRating = Number(rating) || 0;
    const fullStars = Math.floor(normalizedRating);
    const hasHalfStar = normalizedRating - fullStars >= 0.5;

    return Array.from({ length: 5 }, (_, index) => {
      if (index < fullStars) {
        return <Star key={index} size={size} fill="currentColor" className="text-amber-500" />;
      }

      if (index === fullStars && hasHalfStar) {
        return <StarHalf key={index} size={size} fill="currentColor" className="text-amber-500" />;
      }

      return <Star key={index} size={size} className="text-slate-300" />;
    });
  };

  return (
  <div className="flex min-h-screen flex-col overflow-x-hidden bg-white text-gray-900">

      {/* NAVBAR */}

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/50 bg-white/90 shadow-sm backdrop-blur-2xl">

        <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">

          {/* LOGO */}

          <button
            type="button"
            onClick={() => scrollToSection("home")}
            className="mx-auto flex min-w-0 items-center gap-2 px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:gap-3 sm:px-1.5 lg:mx-0 lg:flex-1"
            aria-label="Go to ACGC Services home"
          >
            <img
              src={logo}
              alt="logo"
              className="h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12 lg:h-14 lg:w-14"
            />

            <div className="min-w-0 leading-tight">
              <h1 className="whitespace-nowrap text-[15px] font-semibold text-red-600 sm:text-xl">
                ACGC Services
              </h1>
              <p className="whitespace-nowrap text-[10px] font-medium text-gray-600 sm:text-sm">
                Aluminum & Glass Services
              </p>
            </div>
          </button>

          <div className="hidden flex-wrap items-center gap-1.5 lg:flex md:gap-2">
            <nav className="flex flex-wrap items-center gap-1.5 md:gap-2">
              {[
            { name: "Browse Products", id: "products" },
            { name: "About Us", id: "about" },
            { name: "Track Order", id: "track-order" },
              ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollToSection(item.id)}
              aria-current={active === item.id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-base font-medium transition-colors motion-reduce:transition-none ${
                active === item.id
                    ? "border border-slate-200 bg-slate-100 text-red-700"
                    : "text-slate-700 hover:bg-slate-100"
                  } focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2`}
            >
              {item.name}
            </button>
              ))}
            </nav>

            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-base font-medium text-gray-700 transition-colors hover:bg-slate-100 motion-reduce:transition-none"
            >
              Login
            </Link>

            <Link
              to="/signup"
              className="rounded-full bg-red-600 px-4 py-2 text-base font-medium text-white transition-opacity hover:opacity-90 motion-reduce:transition-none"
            >
              Sign Up
            </Link>

          </div>

        </div>

        <div className="border-t border-slate-100/80 px-2 pb-2 pt-1.5 lg:hidden">
          <nav aria-label="Mobile navigation" className="mx-auto grid max-w-md grid-cols-3 gap-1">
            {[
              { name: "Products", id: "products" },
              { name: "About", id: "about" },
              { name: "Track Order", id: "track-order" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                className={`min-h-8 rounded-lg px-1 text-[11px] font-semibold transition-colors motion-reduce:transition-none ${active === item.id ? "bg-red-50 text-red-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
              >
                {item.name}
              </button>
            ))}
          </nav>
          <div className="mx-auto mt-1.5 grid max-w-md grid-cols-2 gap-2">
            <Link
              to="/login"
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-red-700 px-3 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex min-h-8 items-center justify-center rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Sign Up
            </Link>
          </div>
        </div>

      </header>

      {/* HERO */}

      {active === "home" && (
        <>
          <section id="home" className="relative scroll-mt-28 overflow-hidden bg-[#170d11] pt-32 text-white sm:scroll-mt-24 sm:pt-24">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(239,68,68,0.2),transparent_28%),linear-gradient(135deg,#170d11_0%,#4b1017_38%,#140d13_100%)]" />
            <div className="absolute -left-16 top-28 h-72 w-72 rounded-full border border-white/10" />
            <div className="absolute -right-10 bottom-6 h-80 w-80 rounded-full border border-white/10" />
            <div className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />

            <div className="relative mx-auto max-w-7xl px-6 py-14 sm:py-20">
              <div className="mx-auto max-w-6xl rounded-[32px] border border-white/20 bg-white/[0.08] px-5 py-8 shadow-[0_25px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:px-8 sm:py-12 lg:px-10">
                <div className="mx-auto max-w-4xl text-center">
                  <p className="text-[11px] font-black uppercase tracking-[0.42em] text-red-100/90 sm:text-xs">ACGC Services</p>
                  <h1 className="mt-5 text-4xl font-black leading-[0.96] tracking-[-0.06em] sm:text-6xl lg:text-[5rem]">
                    Custom Glass &amp;
                    <span className="mt-2 block text-red-100/95">Aluminum Solutions</span>
                  </h1>
                  <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-red-50/90 sm:text-lg">
                    Professional fabrication and installation of glass windows, doors, partitions, and aluminum works designed for timeless architecture and practical performance.
                  </p>
                  <div className="mt-9 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => scrollToSection("products")}
                      className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/20 px-6 py-3.5 text-sm font-black uppercase tracking-[0.08em] text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/30"
                    >
                      <ShoppingBag size={18} aria-hidden="true" /> Browse Products <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollToSection("track-order")}
                      className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 py-3.5 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:bg-white/10"
                    >
                      <Search size={18} aria-hidden="true" /> Track an Order
                    </button>
                  </div>
                </div>

                <div className="mt-10 grid gap-4 sm:grid-cols-3">
                  {[
                    { icon: ShieldCheck, title: "Quality Guaranteed", text: "Premium materials and careful workmanship." },
                    { icon: Clock3, title: "Fast Turnaround", text: "Efficient production for your project timeline." },
                    { icon: Wrench, title: "Expert Installation", text: "Professional site inspection and installation." },
                  ].map(({ icon: Icon, title, text }) => (
                    <div key={title} className="rounded-[24px] border border-white/20 bg-white/[0.08] p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-2xl transition hover:-translate-y-1 hover:bg-white/[0.14] sm:p-5">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/[0.12] text-red-100 backdrop-blur-xl">
                        <Icon className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                      </div>
                      <h2 className="mt-4 text-xl font-black text-white">{title}</h2>
                      <p className="mt-2 text-sm leading-6 text-red-50/80">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
      {/* PRODUCTS SECTION */}

      {active === "home" && (
        <section id="featured-products" className="relative mx-auto max-w-7xl scroll-mt-24 px-6 py-8">
          <div className="rounded-[30px] border border-white/65 bg-white/[0.3] p-5 shadow-[0_22px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-7">
            <motion.div
              initial={{ opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="mb-6"
            >
              <p className="text-sm font-black uppercase tracking-[0.24em] text-red-600">Curated collection</p>
              <h2 className="mt-3 text-3xl font-black leading-tight sm:text-5xl sm:leading-none">
                Featured <span className="text-[#dc2626]">Products</span>
              </h2>
              <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-600 sm:text-lg">
                Discover premium aluminum and glass solutions crafted for modern residential and commercial projects.
              </p>
            </motion.div>

            {featuredError ? (
              <div className="rounded-2xl border border-red-200/70 bg-white/40 p-4 text-sm text-red-700 backdrop-blur-xl">
                {featuredError}
              </div>
            ) : isLoadingFeatured ? (
              <div className="grid gap-5 md:grid-cols-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-72 animate-pulse rounded-[26px] border border-white/50 bg-white/35 backdrop-blur-xl" />
                ))}
              </div>
            ) : featuredProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/65 bg-white/35 p-8 text-center text-slate-600 backdrop-blur-xl">
                No products are available right now.
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-3">
                {featuredProducts.map((product, index) => {
                  const imageUrl = getProductImage(product);
                  const reviewStats = featuredProductStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
                  const averageRating = Number(reviewStats.averageRating) || 0;
                  const reviewsCount = Number(reviewStats.ratingsCount) || 0;

                  return (
                    <motion.article
                      key={product._id || product.id || index}
                      initial={{ opacity: 0, y: 44 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.12, duration: 0.6 }}
                      whileHover={{ y: -4 }}
                      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[26px] border border-white/65 bg-white/[0.2] shadow-[0_18px_38px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:shadow-[0_24px_48px_rgba(127,29,29,0.12)]"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100/70">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={product.product_name || product.name || "Featured product"}
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-full w-full bg-gradient-to-br from-red-600/20 via-white/10 to-slate-900/10" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/10 to-transparent" />
                        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-100/95 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-950 shadow-lg backdrop-blur-sm">
                          <Star size={12} fill="currentColor" aria-hidden="true" />
                          Featured
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                        <p className="line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-700">
                          {product.description || "Premium aluminum and glass solution for modern spaces."}
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="flex shrink-0 items-center gap-0.5 text-amber-500">
                            {renderRatingStars(averageRating, 14)}
                          </div>
                          <span className="text-xs font-semibold text-slate-600">
                            {averageRating > 0 ? `${averageRating.toFixed(1)} (${reviewsCount})` : "New"}
                          </span>
                        </div>
                        <div className="mt-auto border-t border-white/60 pt-3">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Starting from</p>
                          <p className="mt-1 text-2xl font-black text-red-700">{getProductPrice(product)}</p>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </div>

          <section className="mt-8 rounded-[30px] border border-white/60 bg-white/[0.32] px-6 py-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:px-10">
            <h2 className="text-center text-3xl font-black text-slate-900">Customer Ratings</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr] md:items-center">
              <div className="text-center">
                <p className="text-6xl font-black leading-none text-slate-950">{featuredRatingStats.average.toFixed(1)}</p>
                <div className="mt-3 flex justify-center gap-1 text-amber-500">
                  {renderRatingStars(featuredRatingStats.average, 22)}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  Average Rating ({featuredRatingStats.total} review{featuredRatingStats.total === 1 ? "" : "s"})
                </p>
              </div>
              <div className="space-y-3">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = featuredRatingStats.counts[star] || 0;
                  const percentage = featuredRatingStats.total
                    ? Math.round((count / featuredRatingStats.total) * 100)
                    : 0;
                  return (
                    <div key={star} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-600">{star}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-white/55">
                        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${percentage}%` }} />
                      </div>
                      <span className="w-12 text-right font-semibold text-slate-500">{percentage}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </section>
      )}

{active === "products" && (
  <section id="products" className="mx-auto max-w-7xl scroll-mt-28 px-4 pb-10 pt-32 sm:px-6 sm:py-14 sm:scroll-mt-24">
    <div className="mb-6 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.25em] text-red-600">ACGC Catalog</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Browse Products</h2>
        <p className="mt-2 text-sm text-slate-600">Browse available aluminum &amp; glass products.</p>
      </div>
      <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_minmax(9rem,12rem)] md:max-w-4xl md:justify-end">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search products</span>
          <Search size={18} className="absolute left-3 top-3.5 text-slate-400" aria-hidden="true" />
          <input
            value={productSearch}
            onChange={(event) => {
              setProductSearch(event.target.value);
              setProductPage(1);
            }}
            placeholder="Search products..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
        </label>
        <label className="min-w-0">
          <span className="sr-only">Filter by product type</span>
          <select
            value={productType}
            onChange={(event) => {
              setProductType(event.target.value);
              setProductPage(1);
            }}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
          >
            <option value="All">All types</option>
            {productTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Filter by category</span>
          <select
            value={productCategory}
            onChange={(event) => {
              setProductCategory(event.target.value);
              setProductPage(1);
            }}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
          >
            <option value="All">All categories</option>
            {productCategoryOptions.map((category) => (
              <option key={category} value={category}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>

    {isLoadingFeatured ? (
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
        {[...Array(8)].map((_, index) => (
          <div key={index} className="h-80 animate-pulse rounded-[26px] border border-slate-200 bg-white" />
        ))}
      </div>
    ) : featuredError ? (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{featuredError}</div>
    ) : visibleProducts.length === 0 ? (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-slate-600 backdrop-blur-xl">
        No products matched your search.
      </div>
    ) : (
      <>
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
          {displayedProducts.map((product, index) => {
            const productId = product._id || product.id || `${product.name}-${index}`;
            const rating = featuredProductStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
            const image = getProductImage(product);
            const productName = product.product_name || product.name || "Unnamed Product";
            const category = product.product_type || product.category || "General";
            const dimensions = product.dimensions || product.standard_size || (
              product.width && product.height ? `${product.width} × ${product.height}` : ""
            );

            return (
              <article
                key={productId}
                role="button"
                tabIndex={0}
                aria-label={`View details for ${productName}`}
                onClick={() => openProductDetails(product)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProductDetails(product);
                  }
                }}
                className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fff7f7_100%)] shadow-[0_16px_40px_rgba(15,23,42,0.08)] transition-all duration-300 ease-out hover:-translate-y-1.5 hover:border-red-200 hover:shadow-[0_22px_55px_rgba(127,29,29,0.12)] motion-reduce:transition-none"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                  {image ? (
                    <img src={image} alt={productName} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110 motion-reduce:transition-none" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-red-600/10 to-slate-100 text-sm text-slate-500">No image available</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/10 to-transparent" />
                  <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
                    {product.is_featured ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-amber-200/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-950 backdrop-blur-sm">
                        <Star size={11} fill="currentColor" aria-hidden="true" /> Top Product
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/20 bg-slate-900/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
                        {product.category || "General"}
                      </span>
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
                    <span className="max-w-[70%] truncate rounded-full border border-white/25 bg-slate-950/40 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-slate-100 backdrop-blur-sm">
                      {category}
                    </span>
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/60 bg-white/90 text-red-700 shadow-lg" aria-hidden="true">
                      <ArrowRight size={17} />
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-[17px] font-black leading-tight text-slate-900" title={productName}>{productName}</h3>
                    <p className="mt-1 truncate text-[12px] font-medium text-slate-600">{category}</p>
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]">
                    <span className="flex shrink-0 items-center gap-0.5 text-amber-400">{renderRatingStars(rating.averageRating || 0, 13)}</span>
                    <span className="truncate font-medium text-slate-700">
                      {rating.ratingsCount ? `${rating.averageRating.toFixed(1)} · ${rating.ratingsCount} reviews` : "No ratings yet"}
                    </span>
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    {dimensions && (
                      <p className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">Dimensions</span>
                        <span className="truncate font-semibold text-slate-700">{dimensions}</span>
                      </p>
                    )}
                    <p className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-500">Unit rate</span>
                      <span className="font-semibold text-slate-700">{getProductUnitRate(product)}</span>
                    </p>
                  </div>

                  <div className="mt-auto border-t border-slate-200 pt-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Starting from</p>
                    <p className="mt-1 text-[22px] font-black text-red-700">{getProductPrice(product)}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!isMobile && visibleProducts.length > 0 && (
          <div className="mt-6 flex flex-col gap-4 rounded-[20px] border border-red-100 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-600">
              <span>Items per page</span>
              <select
                value={productsPerPage}
                onChange={(event) => {
                  setProductsPerPage(Number(event.target.value));
                  setProductPage(1);
                }}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              >
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={16}>16</option>
              </select>
            </label>
            <p className="text-center text-sm font-medium text-slate-600">
              Showing {productPageStart + 1}-{Math.min(productPageStart + productsPerPage, visibleProducts.length)} of {visibleProducts.length}
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                disabled={currentProductPage === 1}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="min-w-16 text-center text-sm font-bold text-slate-700">{currentProductPage} / {productPageCount}</span>
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
                disabled={currentProductPage === productPageCount}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </>
    )}
  </section>
)}

{selectedProduct && (
  <div
    className="mobile-fullscreen-overlay fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5"
    onClick={() => setSelectedProduct(null)}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-product-dialog-title"
      className="mobile-fullscreen-dialog relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-red-500/25 bg-gradient-to-r from-red-700 to-red-800 px-5 py-4 text-white sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/25">
            <Package size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-100">Product details</p>
            <h2 id="landing-product-dialog-title" className="truncate text-lg font-black sm:text-xl">
              {selectedProduct.product_name || selectedProduct.name || "Product"}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedProduct(null)}
          aria-label="Close product details"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-6 md:grid-cols-[1.1fr_0.9fr]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-2xl bg-slate-100">
            {getProductImage(selectedProduct) ? (
              <img
                src={getProductImage(selectedProduct)}
                alt={selectedProduct.product_name || selectedProduct.name || "Product"}
                className="aspect-[4/3] max-h-[340px] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-red-600/10 to-slate-100 text-sm text-slate-500">
                No image available
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-bold text-slate-900">Product Details</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
              {selectedProduct.description || "No description available."}
            </p>
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">
              {selectedProduct.product_type || selectedProduct.type || "Glass & Aluminum"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
              {selectedProduct.category || "General"}
            </span>
          </div>
          <h3 className="text-2xl font-black leading-tight text-slate-900">
            {selectedProduct.product_name || selectedProduct.name || "Product"}
          </h3>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Customer Rating</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-0.5">{renderRatingStars(selectedProductRating.averageRating, 16)}</span>
              <span className="text-sm font-bold text-slate-900">
                {selectedProductRating.ratingsCount ? `${selectedProductRating.averageRating.toFixed(1)} / 5` : "No ratings yet"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {selectedProductRating.ratingsCount} rating{selectedProductRating.ratingsCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Starting from</p>
            <p className="mt-1 text-2xl font-black text-red-700">{getProductPrice(selectedProduct)}</p>
            <p className="mt-1 text-xs text-slate-500">Price may vary based on specifications.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Dimensions</p>
              <p className="mt-1 text-sm font-bold text-slate-800">
                {selectedProduct.dimensions || selectedProduct.standard_size || (
                  selectedProduct.width > 0 || selectedProduct.height > 0
                    ? `${selectedProduct.width || 0} × ${selectedProduct.height || 0}`
                    : "N/A"
                )}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Unit rate</p>
              <p className="mt-1 text-sm font-bold text-slate-800">{getProductUnitRate(selectedProduct)}</p>
            </div>
          </div>
          <ProductPriceEstimator
            product={selectedProduct}
            form={productEstimatorForm}
            onFormChange={setProductEstimatorForm}
            formatCurrency={formatCurrency}
          />
          {false && <section className="overflow-hidden rounded-xl border border-slate-200 border-t-2 border-t-red-600 bg-white p-4" aria-labelledby="landing-product-estimator-title">
            <div className="flex items-center gap-2">
              <Ruler size={16} className="text-red-600" aria-hidden="true" />
              <h4 id="landing-product-estimator-title" className="text-sm font-bold text-slate-900">Price Estimator</h4>
            </div>
            {isBladeProduct(selectedProduct) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Array.isArray(selectedProduct.blade_glass_types) && selectedProduct.blade_glass_types.length > 0 && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Glass type</span>
                    <select
                      value={productEstimatorForm.blade_glass_type}
                      onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_glass_type: event.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      {selectedProduct.blade_glass_types.map((glass) => (
                        <option key={glass.name} value={glass.name}>{glass.name} — {formatCurrency(glass.price_per_blade)} / blade</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedProduct.sell_with_frame && selectedProduct.sell_blades_only !== false && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Sold as</span>
                    <select
                      value={productEstimatorForm.custom_frame_size ? "custom_frame" : productEstimatorForm.sale_mode === "frame" ? `frame:${productEstimatorForm.frame_type}` : "blades_only"}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "blades_only") {
                          const bladeCount = Number(selectedProduct.minimum_blades) || Number(selectedProduct.blade_count) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: value, frame_type: "", custom_frame_size: false, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        } else if (value === "custom_frame") {
                          const bladeCount = Number(selectedProduct.minimum_blades) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: "frame", frame_type: "", custom_frame_size: true, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        } else {
                          const frame = selectedProduct.blade_frame_types.find((item) => `frame:${item.name}` === value);
                          const bladeCount = Number(frame?.blade_count) || Number(selectedProduct.minimum_blades) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: "frame", frame_type: frame?.name || "", custom_frame_size: false, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        }
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      <option value="blades_only">Blades only</option>
                      {(selectedProduct.blade_frame_types || []).map((frame) => (
                        <option key={frame.name} value={`frame:${frame.name}`}>{frame.name} — {Number(frame.blade_count) || 0} blades + {formatCurrency(frame.price)}</option>
                      ))}
                      {selectedProduct.allow_custom_frame_size && <option value="custom_frame">Custom frame — {formatCurrency(selectedProduct.custom_frame_price)}</option>}
                    </select>
                  </label>
                )}
                {productEstimatorForm.sale_mode === "frame" && !productEstimatorForm.custom_frame_size && (selectedProduct.blade_frame_types || []).length > 0 && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Frame type</span>
                    <select
                      value={productEstimatorForm.frame_type}
                      onChange={(event) => {
                        const frame = selectedProduct.blade_frame_types.find((item) => item.name === event.target.value);
                        const bladeCount = Number(frame?.blade_count) || Number(selectedProduct.minimum_blades) || 1;
                        setProductEstimatorForm((current) => ({ ...current, frame_type: event.target.value, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      {selectedProduct.blade_frame_types.map((frame) => <option key={frame.name} value={frame.name}>{frame.name} — {Number(frame.blade_count) || 0} blades</option>)}
                    </select>
                  </label>
                )}
                <label className="min-w-0">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Blade count</span>
                  {selectedProduct.customer_can_choose_blade_count ? (
                    <>
                      <input
                        type="number"
                        min={bladeCountMinimum}
                        max={productBladeMaximum || undefined}
                        step="1"
                        value={productEstimatorForm.blade_count}
                        onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_count: event.target.value }))}
                        placeholder={`min ${bladeCountMinimum}`}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                      />
                      <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                        Minimum for your size: <strong>{bladeCountMinimum} blade{bladeCountMinimum === 1 ? "" : "s"}</strong>. {productBladeMaximum > 0 ? <>Maximum: <strong>{productBladeMaximum} blade{productBladeMaximum === 1 ? "" : "s"}</strong>. </> : null}Final count is confirmed by our team.
                      </span>
                    </>
                  ) : (
                    <span className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-700">
                      {effectiveBladeCount}
                    </span>
                  )}
                </label>
              </div>
            )}
            {(!isBladeProduct(selectedProduct) || productEstimatorForm.custom_frame_size) && (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(88px,0.8fr)]">
              <label className="min-w-0">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Width</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={productEstimatorForm.width}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, width: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </label>
              <span className="mt-6 text-sm text-slate-400" aria-hidden="true">×</span>
              <label className="min-w-0">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Height</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={productEstimatorForm.height}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, height: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </label>
              <label className="col-span-3 min-w-0 sm:col-span-1">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Unit</span>
                <select
                  value={productEstimatorForm.unit}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, unit: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                >
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
            </div>
            )}
            {(isBladeProduct(selectedProduct)
              ? effectiveBladeCount >= bladeCountMinimum
                && (!productBladeMaximum || effectiveBladeCount <= productBladeMaximum)
                && (!selectedProduct.blade_glass_types?.length || Boolean(productEstimatorForm.blade_glass_type))
              : productEstimatorWidth > 0 && productEstimatorHeight > 0) ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2"><Ruler size={13} aria-hidden="true" />{isBladeProduct(selectedProduct) ? "Blade count" : "Area"}</span>
                  <span className="font-bold text-slate-900">
                    {isBladeProduct(selectedProduct)
                      ? productEstimatorResult?.areaDisplay
                      : Number(productEstimatorResult?.estimated_area) > 0
                      ? `${Number(productEstimatorResult.estimated_area).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft`
                      : productEstimatorResult?.areaDisplay || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Base Rate</span>
                  <span className="font-bold text-slate-900">
                    {Number(productEstimatorResult?.rate) > 0
                      ? `${formatCurrency(productEstimatorResult.rate)} / ${productEstimatorResult?.areaDisplay?.includes("blade") ? "blade" : Number(productEstimatorResult?.estimated_area) > 0 ? "sq ft" : "unit"}`
                      : "Contact us"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-red-800">
                  <span className="font-bold">Estimated Total</span>
                  <span className="text-base font-black">
                    {Number(productEstimatorResult?.estimated_price) > 0 ? formatCurrency(productEstimatorResult.estimated_price) : "Contact us"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-1">
                  <span>50% Downpayment</span>
                  <span className="font-bold text-red-800">
                    {Number(productEstimatorResult?.estimated_price) > 0 ? formatCurrency(productEstimatorResult.estimated_price * 0.5) : "Contact us"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex min-h-12 items-center justify-center rounded-lg bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-500">
                {isBladeProduct(selectedProduct) ? "Choose a glass type and valid blade count to calculate your estimate." : "Enter width &amp; height to calculate your estimate."}
              </div>
            )}
            <p className="mt-2 text-[11px] font-semibold leading-4 text-slate-500">
              Final pricing is subject to negotiation during shop discussion or on-site inspection.
            </p>
          </section>}
          <Link
            to="/login"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Place Order Request <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </section>
  </div>
)}

{active === "track-order" && (
<section id="track-order" className="scroll-mt-24 bg-white px-4 pb-14 pt-32 text-slate-900 sm:px-6">
  <div className="mx-auto max-w-7xl rounded-[20px] border border-slate-200 bg-white p-6 text-slate-900 max-[560px]:p-4">
    <div className="border-b border-slate-200 pb-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <Truck size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[18px] font-medium leading-tight text-slate-900">Track an Order</h2>
          <p className="mt-1 text-[13px] text-slate-500">Enter your tracking number to see current order status.</p>
        </div>
      </div>
      <form className="mt-3.5 flex w-full items-center gap-2" onSubmit={handleTrackOrder}>
        <label className="min-w-0 flex-1">
          <input
            type="text"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            placeholder="Enter tracking ID"
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none"
          />
        </label>
        <button type="submit" disabled={trackingLoading} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none">
          {trackingLoading && <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          {trackingLoading ? "Searching..." : "Track"}
        </button>
      </form>
    </div>
    {trackingError && <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{trackingError}</div>}
    {trackingResult && (
      <>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-[0.1em] text-red-700 uppercase">Order status</p>
            <h3 className="mt-1 text-[21px] font-medium leading-tight text-slate-900">Tracking Details</h3>
          </div>
          {(() => {
            const StatusIcon = getStatusBadgeIcon(trackingResult.status);
            return (
              <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium capitalize ${getStatusBadgeClass(trackingResult.status)}`}>
                <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
                <StatusIcon size={15} aria-hidden="true" />
                {statusLabel(trackingResult.status)}
              </span>
            );
          })()}
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
                <Truck size={19} aria-hidden="true" />
              </div>
              <div>
                <p className="text-[11px] font-medium tracking-[0.1em] text-red-700">Progress</p>
                <h4 className="text-[19px] font-medium leading-tight text-slate-900">Order Timeline</h4>
              </div>
            </div>
            <OrderProgressTimeline order={trackingResult} />
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3.5 sm:gap-4 sm:py-4 xl:grid-cols-4">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">GRAND TOTAL</p>
                <p className="mt-1 text-[18px] font-medium text-red-700">{formatCurrency(trackingPaymentSummary.totalAmount)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">AMOUNT PAID</p>
                <p className="mt-1 text-[18px] font-medium text-emerald-600">{formatCurrency(trackingPaymentSummary.paidAmount)}</p>
                <p className="mt-1 text-[10px] text-slate-500">Required downpayment: {formatCurrency(trackingPaymentSummary.requiredAmount)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">BALANCE</p>
                <p className="mt-1 text-[18px] font-medium text-slate-900">{formatCurrency(trackingPaymentSummary.remainingAmount)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">PAYMENT STATUS</p>
                <span className={`mt-1 inline-flex min-h-8 w-full items-center justify-center rounded-full border px-3 text-xs font-medium ${trackingPaymentSummary.status.key === "paid" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : trackingPaymentSummary.status.key === "pending" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-sky-300 bg-sky-50 text-sky-800"}`}>
                  {trackingPaymentSummary.status.label.toUpperCase()}
                </span>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-[18px] lg:sticky lg:top-4">
            <h4 className="text-[17px] font-medium text-slate-900">Order Summary</h4>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Tracking ID</p>
                <p className="break-all font-mono text-[13px] font-medium text-slate-900">{trackingResult.tracking || trackingResult._id || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Customer</p>
                <p className="break-words text-sm font-medium text-slate-900">{getOrderCustomerName(trackingResult)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Phone</p>
                <p className="break-words text-sm font-medium text-slate-900">{trackingResult.customer_phone || trackingResult.customer?.phone || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Order Date</p>
                <p className="break-words text-sm font-medium text-slate-900">{formatDateText(trackingResult.createdAt || trackingResult.created_at)}</p>
              </div>
              <div className="col-span-2 min-w-0">
                <p className="text-xs text-slate-500">Address</p>
                <p className="break-words text-sm font-medium text-slate-900">{getOrderShippingAddress(trackingResult)}</p>
              </div>
            </div>

            <p className="mt-4.5 text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">Products ({trackingResult.items?.length || 0})</p>
            <div>
              {trackingResult.items?.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllTrackedItems((visible) => !visible)}
                  aria-expanded={showAllTrackedItems}
                  className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none"
                >
                  {showAllTrackedItems ? "Show less" : `Show all ${trackingResult.items.length}`}
                  {showAllTrackedItems ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                </button>
              )}
              {(trackingResult.items || []).slice(0, showAllTrackedItems ? undefined : 3).map((item, index) => {
                const itemName = item?.name || item?.product_name || `Product ${index + 1}`;
                const itemQty = Number(item?.quantity || item?.qty || 1);
                const itemTotal = getTrackedItemAmount(item);

                return (
                  <div key={`${item?.product_id || itemName}-${index}`} className="flex items-center justify-between gap-2.5 border-t border-slate-200 py-2.5 first:mt-2.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-slate-900">{itemName}</p>
                      <p className="text-xs text-slate-500">Qty: {itemQty}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-slate-900">{formatCurrency(itemTotal)}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <div>
                <p className="text-xs text-slate-500">Items</p>
                <p className="text-[15px] font-medium text-slate-900">{Array.isArray(trackingResult.items) ? trackingResult.items.length : 0}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Total</p>
                <p className="text-[22px] font-medium leading-tight text-red-700">{formatCurrency(getFinalProjectCost(trackingResult))}</p>
              </div>
            </div>
          </aside>
        </div>
      </>
    )}
  </div>
</section>
)}


{/* ABOUT SECTION */}

{active === "about" && (
<section id="about" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-28">

  <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
    <motion.div
      initial={{ opacity: 0, y: -18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55 }}
      className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-600"><BriefcaseBusiness size={17} /></span>
        <h2 className="text-3xl font-black tracking-tight text-slate-950">About Us</h2>
      </div>
      <span className="rounded-full border border-red-200 bg-white px-5 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-red-700">
        ACGC Services
      </span>
    </motion.div>

    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
        className="space-y-5"
      >
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">Who We Are</p>
          <p className="mt-3 text-sm leading-8 text-slate-600">
            ACGC Aluminum &amp; Glass Construction provides durable and professional aluminum and glass solutions for residential and commercial spaces. We combine accurate measurements, quality materials, and dependable installation services to help every project feel complete.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="rounded-2xl border border-slate-100 bg-slate-50 p-5"
          >
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-red-700">Our Mission</p>
            <p className="mt-3 text-sm leading-7 text-slate-600">To deliver clean, dependable, and customer-focused aluminum and glass workmanship.</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="rounded-2xl border border-slate-100 bg-slate-50 p-5"
          >
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-red-700">Our Work</p>
            <p className="mt-3 text-sm leading-7 text-slate-600">Windows, doors, partitions, shutters, safety glass, and custom aluminum fabrication.</p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="rounded-2xl border border-red-100 bg-red-50 p-5"
        >
          <p className="text-[11px] font-black uppercase tracking-[0.25em] text-red-700">Our Promise</p>
          <p className="mt-3 text-sm leading-7 text-slate-700">Every job is handled with honest guidance, careful project planning, and professional execution.</p>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 40 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
        className="rounded-[24px] bg-slate-950 p-6 text-white"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <span className="text-[11px] font-black uppercase tracking-[0.26em] text-red-300">Our Process</span>
          <span className="rounded-full border border-white/20 px-4 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">01 → 04</span>
        </div>
        <div className="mt-6 space-y-5">
          {[
            ["Consultation", "Learn your project needs and timeline."],
            ["Measurement", "Plan the precise fit and materials."],
            ["Fabrication", "Produce the aluminum and glass elements."],
            ["Installation", "Finish the project with quality workmanship."],
          ].map(([title, description], index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: 18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.15 + index * 0.12, duration: 0.5 }}
              className="flex items-start gap-3"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-black text-white">{String(index + 1).padStart(2, "0")}</span>
              <div className="pt-0.5">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-white">{title}</p>
                <p className="mt-1 text-xs leading-6 text-slate-300">{description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  </div>

</section>
)}

{/* FOOTER */}

<footer className="relative left-1/2 mt-auto w-screen -translate-x-1/2 border-t border-border bg-muted/50 text-foreground dark:bg-card">
  <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="grid gap-6 md:gap-8 lg:grid-cols-3">
      <div>
        <div className="flex items-center gap-3">
          <img src={logo} alt="logo" className="h-10 w-14 object-contain" />
          <div>
            <h3 className="text-base font-medium text-foreground">ACGC Aluminum Services</h3>
            <p className="text-xs text-muted-foreground">Premium Glass &amp; Aluminum Solutions</p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-medium text-foreground">Quick Links</h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          {[
            ["Home", "home"],
            ["Browse Products", "products"],
            ["Track Order", "track-order"],
            ["About Us", "about"],
          ].map(([label, sectionId]) => (
            <button key={sectionId} type="button" onClick={() => scrollToSection(sectionId)} className="block transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-medium text-foreground">Contact</h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Email: acgc.services00@email.com</p>
          <p>Phone: +63 900 000 0000</p>
          <p>Philippines</p>
        </div>
      </div>
    </div>

    <div className="mt-6 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
      © 2026 ACGC Aluminum Services — All Rights Reserved.
    </div>
  </div>
</footer>

</div>
  );
}

export default LandingPage;
