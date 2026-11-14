import React from "react";

interface WhatsAppLogoProps {
  className?: string;
  useBrandColors?: boolean;
}

export default function WhatsAppLogo({ className = "h-4 w-4", useBrandColors = true }: WhatsAppLogoProps) {
  if (useBrandColors) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Authentic WhatsApp green chat bubble */}
        <path
          fill="#25D366"
          d="M12.004 2C6.48 2 2 6.48 2 12.004c0 1.946.557 3.766 1.522 5.305L2.05 22l4.834-1.428A9.957 9.957 0 0012.004 22C17.524 22 22 17.52 22 12.004 22 6.48 17.524 2 12.004 2z"
        />
        {/* Authentic WhatsApp white phone handset */}
        <path
          fill="#FFFFFF"
          d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.476-.15-.677.15-.2.301-.777.98-.953 1.18-.175.2-.351.226-.652.075-.301-.15-1.272-.469-2.423-1.496-.896-.799-1.501-1.786-1.677-2.087-.175-.3-.019-.463.132-.613.136-.135.301-.351.452-.526.15-.175.201-.3.301-.501.1-.2.05-.376-.025-.526-.075-.15-.677-1.631-.928-2.237-.244-.59-.492-.51-.677-.52l-.577-.008c-.2 0-.526.075-.802.376-.276.301-1.053 1.028-1.053 2.508 0 1.48 1.079 2.91 1.229 3.11.15.201 2.122 3.24 5.141 4.544.718.31 1.279.496 1.716.634.722.23 1.38.197 1.901.12.58-.087 1.78-.727 2.03-1.43.251-.702.251-1.304.176-1.43-.075-.125-.276-.2-.577-.35z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12.004 2C6.48 2 2 6.48 2 12.004c0 1.946.557 3.766 1.522 5.305L2.05 22l4.834-1.428A9.957 9.957 0 0012.004 22C17.524 22 22 17.52 22 12.004 22 6.48 17.524 2 12.004 2z" />
    </svg>
  );
}
