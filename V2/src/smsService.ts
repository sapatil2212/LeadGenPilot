/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from "./logger";
import { env } from "./env";

/**
 * SMS service for sending OTP codes via SMS.
 * 
 * In production, integrate with providers like:
 * - Twilio
 * - AWS SNS
 * - Vonage (Nexmo)
 * - MSG91 (India)
 * - TextLocal (India)
 * 
 * For now, this is a development stub that logs to console.
 * Set SMS_PROVIDER env var to enable real SMS sending.
 */

export type SmsPurpose = "phone_verify" | "login" | "reset";

interface SmsOptions {
  phone: string;
  code: string;
  purpose: SmsPurpose;
}

/**
 * Formats the SMS message based on purpose
 */
function formatSmsMessage(code: string, purpose: SmsPurpose): string {
  const appName = env.auth.appName || "LeadGenPilot";
  
  switch (purpose) {
    case "phone_verify":
      return `${appName}: Your phone verification code is ${code}. Valid for 10 minutes. Do not share this code with anyone.`;
    case "login":
      return `${appName}: Your login code is ${code}. Valid for 10 minutes. Do not share this code with anyone.`;
    case "reset":
      return `${appName}: Your password reset code is ${code}. Valid for 10 minutes. If you didn't request this, please ignore.`;
    default:
      return `${appName}: Your verification code is ${code}. Valid for 10 minutes.`;
  }
}

/**
 * Validates phone number format (international format)
 */
export function isValidPhone(phone: string): boolean {
  // Basic validation: starts with + and has 10-15 digits
  const phoneRegex = /^\+[1-9]\d{9,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Normalizes phone number to international format
 */
export function normalizePhone(phone: string): string {
  // Remove all spaces, hyphens, parentheses
  let normalized = phone.replace(/[\s\-\(\)]/g, "");
  
  // If it doesn't start with +, add +91 for India (adjust based on your primary market)
  if (!normalized.startsWith("+")) {
    // If starts with 0, remove it (common in India)
    if (normalized.startsWith("0")) {
      normalized = normalized.substring(1);
    }
    // Add country code if it looks like a 10-digit number
    if (normalized.length === 10 && /^\d{10}$/.test(normalized)) {
      normalized = `+91${normalized}`;
    } else if (!normalized.startsWith("+")) {
      normalized = `+${normalized}`;
    }
  }
  
  return normalized;
}

/**
 * Sends an OTP code via SMS
 * Returns true if sent successfully, false otherwise
 */
export async function sendSmsOtp(options: SmsOptions): Promise<boolean> {
  const { phone, code, purpose } = options;
  
  // Validate phone number
  if (!isValidPhone(phone)) {
    logger.error(`Invalid phone number format: ${phone}`);
    return false;
  }
  
  const message = formatSmsMessage(code, purpose);
  
  try {
    // In development mode, just log the OTP
    if (env.isDevelopment) {
      logger.info("═══════════════════════════════════════════════");
      logger.info(`📱 SMS OTP (Development Mode)`);
      logger.info(`To: ${phone}`);
      logger.info(`Purpose: ${purpose}`);
      logger.info(`Code: ${code}`);
      logger.info(`Message: ${message}`);
      logger.info("═══════════════════════════════════════════════");
      return true;
    }
    
    // TODO: Integrate with actual SMS provider in production
    // Example integrations below:
    
    /*
    // Twilio Example:
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    */
    
    /*
    // MSG91 Example (Popular in India):
    const axios = require('axios');
    await axios.post('https://api.msg91.com/api/v5/flow/', {
      template_id: process.env.MSG91_TEMPLATE_ID,
      short_url: "0",
      recipients: [{
        mobiles: phone,
        OTP: code
      }]
    }, {
      headers: {
        'authkey': process.env.MSG91_AUTH_KEY,
        'content-type': 'application/json'
      }
    });
    */
    
    /*
    // AWS SNS Example:
    const AWS = require('aws-sdk');
    const sns = new AWS.SNS();
    await sns.publish({
      Message: message,
      PhoneNumber: phone,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional'
        }
      }
    }).promise();
    */
    
    // No production provider is configured. Never log the plaintext OTP.
    logger.warn(`SMS provider is not configured; verification SMS was not sent to ${maskPhone(phone)}.`);
    return false;
    
  } catch (error) {
    logger.error("Failed to send SMS OTP", error);
    return false;
  }
}

/**
 * Masks phone number for display (e.g., +91******3456)
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return phone;
  
  const lastFour = phone.slice(-4);
  const prefix = phone.startsWith("+") ? phone.slice(0, 3) : "";
  const masked = "*".repeat(Math.max(0, phone.length - prefix.length - 4));
  
  return `${prefix}${masked}${lastFour}`;
}
