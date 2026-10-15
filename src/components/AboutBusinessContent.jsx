const stats = [
  ["14+", "Years of Experience"],
  ["500+", "Happy Clients"],
  ["1,200+", "Projects Completed"],
  ["7 Days", "Avg. Turnaround"],
];

const services = [
  "Custom Glass Windows & Doors",
  "Aluminum Frames & Partitions",
  "Sliding Doors & Panels",
  "Site Inspection & Consultation",
  "Professional Installation",
];

const process = [
  ["Order Request", "Submit your custom order with dimensions."],
  ["Site Inspection", "Our team visits to take precise measurements."],
  ["Fabrication", "Your order is crafted in our workshop."],
  ["Installation", "Professional installation at your location."],
];

function AboutBusinessContent({ darkMode = false }) {
  const card = darkMode
    ? "border-slate-700 bg-slate-800 text-slate-100"
    : "border-slate-200 bg-white text-slate-900";
  const subtle = darkMode ? "text-slate-400" : "text-slate-600";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className={`rounded-xl border p-4 text-center shadow-sm sm:p-5 ${card}`}>
            <p className="text-2xl font-black text-red-700 sm:text-3xl">{value}</p>
            <p className={`mt-2 text-xs font-medium ${subtle}`}>{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={`rounded-xl border p-5 shadow-sm sm:p-6 ${card}`}>
          <h3 className="border-b pb-3 text-lg font-bold">Our Services</h3>
          <ul className={`mt-2 divide-y ${darkMode ? "divide-slate-700" : "divide-slate-200"}`}>
            {services.map((service) => (
              <li key={service} className={`flex items-center gap-2 py-2.5 text-sm ${subtle}`}>
                <span className="text-red-700" aria-hidden="true">•</span>{service}
              </li>
            ))}
          </ul>
        </section>

        <section className={`rounded-xl border p-5 shadow-sm sm:p-6 ${card}`}>
          <h3 className="border-b pb-3 text-lg font-bold">Contact Information</h3>
          <div className="mt-3 space-y-3 text-sm">
            <p className={`rounded-md border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
              <strong className="mr-2 text-red-700">Phone:</strong><a href="tel:+639123456789" className="hover:underline">+63 912 345 6789</a>
            </p>
            <p className={`rounded-md border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
              <strong className="mr-2 text-red-700">Address:</strong>Maligaya 1, Katasaan, Dinalupihan, Bataan
            </p>
            <p className={`rounded-md border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
              <strong className="mr-2 text-red-700">Business Hours:</strong>Mon–Sat: 8:00 AM – 6:00 PM
            </p>
          </div>
        </section>
      </div>

      <section>
        <h3 className={`mb-4 text-center text-2xl font-black ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Our Process</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {process.map(([title, description], index) => (
            <div key={title} className={`rounded-xl border p-4 text-center shadow-sm sm:p-5 ${card}`}>
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-red-800 text-sm font-bold text-white shadow">
                {index + 1}
              </span>
              <h4 className="mt-3 text-sm font-bold">{title}</h4>
              <p className={`mt-1.5 text-xs leading-5 ${subtle}`}>{description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default AboutBusinessContent;
