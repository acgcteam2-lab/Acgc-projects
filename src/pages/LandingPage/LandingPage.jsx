import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Menu,
  X,
  ArrowRight,
  ShoppingBag,
  Search,
  BriefcaseBusiness,
  ShieldCheck,
  Clock3,
  Wrench,
  Truck,
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
import { getPaymentSummary } from "@/pages/Transactions/paymentProofUtils";
import { getProducts } from "../../api/products";
import { getProductReviews, trackOrder } from "../../api/orders";
import logo from "../../assets/images/ACGCLOGO1.png";

function LandingPage() {

  const [active, setActive] = useState("home");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
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
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
              const reviewResponse = await getProductReviews(product._id || product.id);
              const reviews = Array.isArray(reviewResponse.reviews) ? reviewResponse.reviews : [];
              const ratedReviews = reviews.filter((review) => Number(review.rating) > 0);
              const averageRating = ratedReviews.length
                ? ratedReviews.reduce((sum, review) => sum + Number(review.rating), 0) / ratedReviews.length
                : 0;

              return {
                product,
                averageRating,
                ratingsCount: ratedReviews.length,
                ratingCounts: [5, 4, 3, 2, 1].reduce((counts, star) => {
                  counts[star] = ratedReviews.filter((review) => Math.round(Number(review.rating)) === star).length;
                  return counts;
                }, {}),
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
          return candidate;
        }
      }
    }

    return "";
  };

  const getProductPrice = (product) => {
    if (!product) return "Contact us";
    const pricePerSqft = Number(product.price_per_sqft || 0);
    const unitPrice = Number(product.unit_price || 0);
    if (pricePerSqft > 0) return `₱${pricePerSqft.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/sqft`;
    if (unitPrice > 0) return `₱${unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return "Contact us";
  };

  const visibleProducts = catalogProducts.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    return !query || `${product.name || ""} ${product.product_name || ""} ${product.category || ""} ${product.description || ""}`
      .toLowerCase()
      .includes(query);
  });

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
    const shipping = order.shipping_address || order.customer?.shipping_address || {};
    const addressParts = [
      shipping.street_address || shipping.street || shipping.address_line || shipping.line1,
      shipping.city,
      shipping.province || shipping.state,
      shipping.zip_code || shipping.postal_code,
    ].filter(Boolean);

    if (addressParts.length > 0) return addressParts.join(", ");
    return order.customer?.street_address || order.customer?.city ? [order.customer.street_address, order.customer.city, order.customer.province].filter(Boolean).join(", ") : "—";
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

      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-2xl">

        <div className="w-full px-4 py-2.5 flex items-center justify-between gap-3">

          {/* LOGO */}

          <button
            type="button"
            onClick={() => scrollToSection("home")}
            className="flex items-center gap-3 px-1.5 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            aria-label="Go to ACGC Services home"
          >
            <img
              src={logo}
              alt="logo"
              className="w-14 h-14 object-contain"
            />

            <div className="leading-tight">
              <h1 className="text-xl font-medium text-red-600">
                ACGC Services
              </h1>
              <p className="text-sm font-medium text-gray-600">
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

          {/* MOBILE MENU */}

          <button
            onClick={()=>setMobileMenu(!mobileMenu)}
            className="rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100 motion-reduce:transition-none lg:hidden"
            aria-label={mobileMenu ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenu}
          >
            {mobileMenu ? <X size={30} aria-hidden="true" /> : <Menu size={30} aria-hidden="true" />}
          </button>

        </div>

        {/* MOBILE DROPDOWN */}

        {mobileMenu && (

          <div className="border-t border-slate-200 bg-white lg:hidden">

            <div className="flex flex-col gap-2 px-4 py-4">

              <button
                type="button"
                onClick={() => {
                  setMobileMenu(false);
                  scrollToSection("products");
                }}
                className={`rounded-full px-4 py-2 text-left text-base font-medium transition-colors motion-reduce:transition-none ${active === "products" ? "border border-slate-200 bg-slate-100 text-red-700" : "text-slate-700 hover:bg-slate-100"}`}
              >
                Browse Products
              </button>

              <button
                onClick={() => scrollToSection("about")}
                className={`rounded-full px-4 py-2 text-left text-base font-medium transition-colors motion-reduce:transition-none ${active === "about" ? "border border-slate-200 bg-slate-100 text-red-700" : "text-slate-700 hover:bg-slate-100"}`}
              >
                About Us
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileMenu(false);
                  scrollToSection("track-order");
                }}
                className={`rounded-full px-4 py-2 text-left text-base font-medium transition-colors motion-reduce:transition-none ${active === "track-order" ? "border border-slate-200 bg-slate-100 text-red-700" : "text-slate-700 hover:bg-slate-100"}`}
              >
                Track Order
              </button>

              <Link
                to="/login"
                onClick={() => setMobileMenu(false)}
                className="rounded-full px-4 py-2 text-center text-base font-medium text-slate-700 transition-colors hover:bg-slate-100 motion-reduce:transition-none"
              >
                Login
              </Link>

              <Link
                to="/signup"
                onClick={() => setMobileMenu(false)}
                className="rounded-full bg-red-600 px-4 py-2 text-center text-base font-medium text-white transition-opacity hover:opacity-90 motion-reduce:transition-none"
              >
                Sign Up
              </Link>

            </div>

          </div>

        )}

      </header>

      {/* HERO */}

      {active === "home" && (
        <>
      <section id="home" className="relative scroll-mt-24 overflow-hidden bg-[#941d24] pt-24 text-white">
        <div className="relative mx-auto flex min-h-[360px] max-w-7xl items-center justify-center px-6 py-16 text-center">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-100">
              ACGC Services
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-6xl">Custom Glass &amp; Aluminum Solutions</h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-red-100 sm:text-lg">
              Professional fabrication and installation of glass windows, doors, partitions, and aluminum works for your space.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => scrollToSection("products")} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-red-700 shadow-lg transition hover:bg-red-50">
                <ShoppingBag size={18} /> Browse Products <ArrowRight size={16} />
              </button>
              <button type="button" onClick={() => scrollToSection("track-order")} className="inline-flex items-center gap-2 rounded-xl border border-white/70 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                <Search size={18} /> View My Orders
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto -mt-8 max-w-5xl px-6">
        <div className="grid gap-6 rounded-3xl bg-white px-6 py-8 text-center shadow-xl sm:grid-cols-3 sm:px-10">
          <div className="flex flex-col items-center"><ShieldCheck className="h-12 w-12 text-slate-900" strokeWidth={1.7} /><h3 className="mt-4 text-xl font-black">Quality Guaranteed</h3><p className="mt-2 text-sm text-slate-600">Premium materials and careful workmanship.</p></div>
          <div className="flex flex-col items-center"><Clock3 className="h-12 w-12 text-slate-900" strokeWidth={1.7} /><h3 className="mt-4 text-xl font-black">Fast Turnaround</h3><p className="mt-2 text-sm text-slate-600">Efficient production for your project timeline.</p></div>
          <div className="flex flex-col items-center"><Wrench className="h-12 w-12 text-slate-900" strokeWidth={1.7} /><h3 className="mt-4 text-xl font-black">Expert Installation</h3><p className="mt-2 text-sm text-slate-600">Professional site inspection and installation.</p></div>
        </div>
      </section>
        </>
      )}
{/* PRODUCTS SECTION */}

    {active === "home" && (
<section id="featured-products" className="relative mx-auto max-w-7xl scroll-mt-24 px-6 py-8">

  <div className="rounded-[24px] border border-red-100 bg-white p-5 shadow-[0_14px_35px_rgba(148,163,184,0.12)]">
  <motion.div
    initial={{opacity:0,y:60}}
    whileInView={{opacity:1,y:0}}
    viewport={{once:true}}
    transition={{duration:1}}
    className="mb-5 text-left"
  >

    <h2 className="text-3xl font-black leading-tight sm:text-5xl sm:leading-none">

      Featured

      <span className="text-red-500">
        {" "}Products
      </span>

    </h2>

    <p className="mt-6 max-w-3xl text-lg text-slate-500">

      Discover premium aluminum and glass solutions crafted for modern residential and commercial projects.

    </p>

  </motion.div>

  <div className="grid gap-4 md:grid-cols-3">
    {isLoadingFeatured ? (
      <div className="col-span-full rounded-[24px] border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
        Loading products...
      </div>
    ) : featuredProducts.length === 0 ? (
      <div className="col-span-full rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-slate-600">
        No products are available right now.
      </div>
    ) : (
      featuredProducts.map((product, index) => {
        const imageUrl = getProductImage(product);
        const reviewStats = featuredProductStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
        const averageRating = Number(reviewStats.averageRating) || 0;
        const reviewsCount = Number(reviewStats.ratingsCount) || 0;

        return (
          <motion.div
            key={product._id || product.id || index}
            initial={{opacity:0,y:80}}
            whileInView={{opacity:1,y:0}}
            viewport={{once:true}}
            transition={{delay:index * 0.12,duration:0.7}}
            whileHover={{scale:1.01}}
            className="group cursor-pointer overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50 shadow-[0_8px_22px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-1 hover:border-red-200 hover:shadow-[0_18px_30px_rgba(239,68,68,0.12)]"
          >
            <div className="relative h-44 overflow-hidden bg-slate-100">
              {imageUrl ? (
                <img src={imageUrl} alt={product.product_name || product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-red-600/20 to-white/5" />
              )}
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-900/25 to-transparent" />
            </div>

            <div className="space-y-5 p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.18em] text-red-700">
                  {product.category || product.product_type || "General"}
                </span>
                <span className="text-base font-extrabold text-emerald-600">{getProductPrice(product)}</span>
              </div>

              <div>
                <h3 className="text-xl font-bold leading-tight text-slate-900">
                  {product.product_name || product.name || "Unnamed Product"}
                </h3>
                <p className="mt-2 line-clamp-2 text-[0.95rem] leading-6 text-slate-700">
                  {product.description || "Premium aluminum and glass product crafted for reliability and style."}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-1 text-amber-500">
                    {renderRatingStars(averageRating, 14)}
                  </div>
                  <span className="mt-1 text-[15px] font-semibold text-slate-600">
                    {averageRating > 0 ? `${averageRating.toFixed(1)} (${reviewsCount} review${reviewsCount === 1 ? "" : "s"})` : "No reviews yet"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => scrollToSection("products")}
                  className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                >
                  View
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        );
      })
    )}
  </div>
  </div>

  <section className="mt-8 rounded-3xl bg-white px-6 py-8 shadow-sm sm:px-10">
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
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
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
<section id="products" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-14">
  <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
    <div>
      <p className="text-xs font-black uppercase tracking-[0.25em] text-red-600">ACGC Catalog</p>
      <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Browse Products</h2>
      <p className="mt-4 max-w-2xl text-slate-600">Explore the complete collection of aluminum and glass products created in the system.</p>
    </div>
    <label className="relative w-full md:max-w-xs">
      <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />
      <input
        value={productSearch}
        onChange={(event) => setProductSearch(event.target.value)}
        placeholder="Search products"
        className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 outline-none focus:border-red-500"
      />
    </label>
  </div>

  {isLoadingFeatured && <p className="py-20 text-center text-slate-500">Loading products...</p>}
  {!isLoadingFeatured && featuredError && <p className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{featuredError}</p>}
  {!isLoadingFeatured && !featuredError && visibleProducts.length === 0 && (
    <p className="mt-10 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500">No products match your search.</p>
  )}

  <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {visibleProducts.map((product) => {
      const productId = product._id || product.id;
      const rating = featuredProductStats[productId] || { averageRating: 0, ratingsCount: 0 };
      const image = getProductImage(product);
      return (
        <article key={productId} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
          <div className="h-64 bg-slate-100">
            {image ? <img src={image} alt={product.product_name || product.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No image available</div>}
          </div>
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-700">{product.category || "General"}</span>
              <span className="font-bold text-emerald-600">{getProductPrice(product)}</span>
            </div>
            <div>
              <h3 className="text-2xl font-black text-slate-900">{product.product_name || product.name || "Unnamed Product"}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{product.description || "Premium aluminum and glass product crafted for reliability and style."}</p>
            </div>
            <div className="flex items-center justify-between gap-3 text-amber-500">
              <div className="flex items-center gap-1">
                {renderRatingStars(rating.averageRating, 15)}
                <span className="ml-1 text-xs font-semibold text-slate-500">{rating.ratingsCount ? `${rating.averageRating.toFixed(1)} (${rating.ratingsCount})` : "No reviews"}</span>
              </div>
              <Link to="/login" className="inline-flex items-center gap-1 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">
                Order <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </article>
      );
    })}
  </div>
</section>
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
                <p className="text-[22px] font-medium leading-tight text-red-700">{formatCurrency(trackingResult.total_amount || trackingResult.total || trackingResult.amount_paid || 0)}</p>
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