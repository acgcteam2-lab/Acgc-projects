import { useEffect, useState } from "react";
import { getPublicContact } from "@/api/auth";

const FALLBACK_PHONE = "+63 912 345 6789";
const FALLBACK_ADDRESS = "Maligaya 1, Katasaan, Dinalupihan, Bataan, Philippines";
const FALLBACK_EMAIL = "acgc.services00@email.com";

export function useAdminContactPhone() {
  const [phone, setPhone] = useState(FALLBACK_PHONE);
  const [address, setAddress] = useState(FALLBACK_ADDRESS);
  const [email, setEmail] = useState(FALLBACK_EMAIL);

  useEffect(() => {
    let active = true;
    getPublicContact()
      .then((response) => {
        const currentPhone = String(response?.phone || "").trim();
        const currentAddress = String(response?.address || "").trim();
        const currentEmail = String(response?.email || "").trim();
        if (active && currentPhone) setPhone(currentPhone);
        if (active && currentAddress) setAddress(currentAddress);
        if (active && currentEmail) setEmail(currentEmail);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return {
    phone,
    phoneHref: `tel:${phone.replace(/[^\d+]/g, "")}`,
    address,
    addressHref: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    email,
    emailHref: `mailto:${email}`,
  };
}
