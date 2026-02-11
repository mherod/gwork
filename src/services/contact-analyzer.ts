/**
 * Contact data quality analysis and marketing detection.
 * Analyzes contacts for generic names, missing data, import artifacts, and marketing patterns.
 */

import type { Person } from "../types/google-apis.ts";

export class ContactAnalyzer {
  /**
   * Extracts full name from contact (given + middle + family).
   */
  private getFullName(contact: Person): string | null {
    const names = contact.names?.[0];
    if (!names) return null;

    const parts: string[] = [];
    if (names.givenName) parts.push(names.givenName);
    if (names.middleName) parts.push(names.middleName);
    if (names.familyName) parts.push(names.familyName);

    return parts.length > 0 ? parts.join(" ") : null;
  }

  /**
   * Checks if name matches generic patterns (e.g., "Contact", "Home", "Test").
   */
  private isGenericName(name: string): boolean {
    const genericPatterns = [
      /^contact$/i,
      /^contact \d+$/i,
      /^home$/i,
      /^work$/i,
      /^mobile$/i,
      /^phone$/i,
      /^email$/i,
      /^unknown$/i,
      /^unnamed$/i,
      /^noname$/i,
      /^test$/i,
      /^\d+$/,
      /^[a-z0-9]+@[a-z0-9]+\.[a-z]+$/i, // Email as name
      /^[+]?[\d\s\-()]+$/, // Phone as name
    ];

    return genericPatterns.some((pattern) => pattern.test(name.trim()));
  }

  /**
   * Extracts surname hints from contact metadata.
   */
  extractSurnameHints(contact: Person): string[] {
    const hints: string[] = [];

    // Try to extract surname from email
    if (contact.emailAddresses?.[0]?.value) {
      const email = contact.emailAddresses[0].value;
      const localPart = email.split("@")[0]!;
      const parts = localPart.split(/[._-]/);
      if (parts.length >= 2) {
        hints.push(`From email: ${parts[parts.length - 1]}`);
      }
    }

    // Try to extract from organization
    if (contact.organizations?.[0]?.name) {
      const org = contact.organizations[0].name;
      const lastWord = org.split(/\s+/).pop();
      if (lastWord && lastWord.length > 2) {
        hints.push(`From organization: ${lastWord}`);
      }
    }

    // Try to extract from phone if it looks like it has a name component
    if (contact.phoneNumbers?.[0]?.value) {
      const phone = contact.phoneNumbers[0].value;
      // Only if phone has non-numeric characters that might be a name
      const nonDigits = phone.replace(/[\d\s\-()]/g, "");
      if (nonDigits.length > 2) {
        hints.push(`From phone: ${nonDigits}`);
      }
    }

    return hints;
  }

  /**
   * Checks if contact appears to be auto-imported (generic patterns).
   */
  private isLikelyImportedContact(contact: Person): boolean {
    const name = this.getFullName(contact) || "";
    const email = contact.emailAddresses?.[0]?.value || "";

    // Auto-generated contact patterns
    const importedPatterns = [
      /^contact\d+/i,
      /^imported_/i,
      /^sync_/i,
      /^\d{5,}$/, // Just numbers as name
      /^test_/i,
      /^no.?name/i,
      /^[a-z0-9]+\+[a-z0-9]+@/i, // Gmail aliases
      /^noreply/i,
      /^do.?not.?reply/i,
      /^mailer/i,
      /^notification/i,
    ];

    const isAutoGenName = importedPatterns.some((pattern) => pattern.test(name));
    const isAutoGenEmail = importedPatterns.some((pattern) => pattern.test(email));

    // Check for minimal data
    const hasMinimalData =
      !contact.emailAddresses ||
      (contact.emailAddresses.length === 1 && !contact.phoneNumbers) ||
      !contact.organizations;

    // Check if name matches email pattern
    const nameMatchesEmail =
      name.toLowerCase().replace(/\s/g, "") === email.split("@")[0]!.toLowerCase();

    return isAutoGenName || (isAutoGenEmail && hasMinimalData) || nameMatchesEmail;
  }

  /**
   * Finds contacts with missing first or last names.
   */
  async findContactsWithMissingNames(
    contacts: Person[]
  ): Promise<{
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      surnameHints: string[];
    }[];
    totalContacts: number;
    contactsWithIssues: number;
  }> {
    const contactsWithIssues: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      surnameHints: string[];
    }[] = [];

    contacts.forEach((contact) => {
      const displayName = contact.names?.[0]?.displayName || "Unknown";

      // Check for missing first name
      const hasGivenName = !!contact.names?.[0]?.givenName;

      // Check for missing last name
      const hasFamilyName = !!contact.names?.[0]?.familyName;

      // Determine issue
      let issueType = "";
      if (!hasGivenName && !hasFamilyName) {
        issueType = "No first or last name";
      } else if (!hasGivenName) {
        issueType = "Missing first name";
      } else if (!hasFamilyName) {
        issueType = "Missing last name";
      }

      if (issueType) {
        const hints = this.extractSurnameHints(contact);
        contactsWithIssues.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
          issueType,
          surnameHints: hints,
        });
      }
    });

    return {
      contacts: contactsWithIssues,
      totalContacts: contacts.length,
      contactsWithIssues: contactsWithIssues.length,
    };
  }

  /**
   * Finds contacts with generic names.
   */
  async findContactsWithGenericNames(
    contacts: Person[]
  ): Promise<{
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      surnameHints: string[];
    }[];
    totalContacts: number;
    contactsWithGenericNames: number;
  }> {
    const contactsWithGenericNames: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      surnameHints: string[];
    }[] = [];

    contacts.forEach((contact) => {
      const displayName = contact.names?.[0]?.displayName || "Unknown";
      const familyName = contact.names?.[0]?.familyName || "";
      const givenName = contact.names?.[0]?.givenName || "";

      // Check if surname is generic
      if (familyName && this.isGenericName(familyName)) {
        const hints = this.extractSurnameHints(contact);
        contactsWithGenericNames.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
          surnameHints: hints,
        });
      }

      // Also check if full name is generic (and it's the only name)
      if (!familyName && this.isGenericName(givenName)) {
        const hints = this.extractSurnameHints(contact);
        contactsWithGenericNames.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
          surnameHints: hints,
        });
      }
    });

    return {
      contacts: contactsWithGenericNames,
      totalContacts: contacts.length,
      contactsWithGenericNames: contactsWithGenericNames.length,
    };
  }

  /**
   * Analyzes contacts to identify likely auto-imported entries.
   */
  async analyzeImportedContacts(
    contacts: Person[]
  ): Promise<{
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      confidence: number;
    }[];
    totalContacts: number;
    importedContacts: number;
  }> {
    const importedContacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      confidence: number;
    }[] = [];

    contacts.forEach((contact) => {
      const displayName = contact.names?.[0]?.displayName || "Unknown";

      // Use isLikelyImportedContact to detect imported contacts
      if (this.isLikelyImportedContact(contact)) {
        const name = this.getFullName(contact) || "";
        const email = contact.emailAddresses?.[0]?.value || "";

        let issueType = "";
        let confidence = 0;

        // Determine specific type and confidence level
        if (name.toLowerCase().startsWith("contact")) {
          issueType = "Auto-generated 'Contact' name";
          confidence = 95;
        } else if (/^imported_|^sync_/.test(name.toLowerCase())) {
          issueType = "Auto-import identifier";
          confidence = 90;
        } else if (/^test_/i.test(name)) {
          issueType = "Test contact";
          confidence = 85;
        } else if (
          /noreply|donotreply|mailer|notification/i.exec(name.toLowerCase())
        ) {
          issueType = "System-generated contact";
          confidence = 80;
        } else if (
          email &&
          (/^[a-z0-9]+\+[a-z0-9]+@/i.exec(email))
        ) {
          issueType = "Email alias (potential import artifact)";
          confidence = 60;
        } else {
          issueType = "Likely imported contact";
          confidence = 50;
        }

        if (confidence > 0) {
          importedContacts.push({
            resourceName: contact.resourceName || "",
            displayName,
            email: contact.emailAddresses?.[0]?.value ?? undefined,
            phone: contact.phoneNumbers?.[0]?.value ?? undefined,
            organization: contact.organizations?.[0]?.name ?? undefined,
            issueType,
            confidence,
          });
        }
      }
    });

    // Sort by confidence descending
    importedContacts.sort((a, b) => b.confidence - a.confidence);

    return {
      contacts: importedContacts,
      totalContacts: contacts.length,
      importedContacts: importedContacts.length,
    };
  }

  /**
   * Analyzes email address for marketing patterns.
   */
  private isMarketingEmail(email: string): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Marketing service prefixes
    const marketingPrefixes = [
      "noreply",
      "no-reply",
      "do-not-reply",
      "donotreply",
      "marketing",
      "newsletter",
      "notifications",
      "notification",
      "noticias",
      "promo",
      "promotion",
      "promotional",
      "unsubscribe",
      "sales",
      "support",
      "help",
      "info",
      "contact",
      "hello",
      "team",
      "no.reply",
      "postmaster",
      "mailer",
      "mailbox",
      "bounce",
      "automated",
      "admin",
      "webmaster",
    ];

    // Marketing domains
    const marketingDomains = [
      "mailchimp.com",
      "sendgrid.net",
      "constantcontact.com",
      "aweber.com",
      "icontact.com",
      "getresponse.com",
      "convertkit.com",
      "klaviyo.com",
      "substack.com",
      "brevo.com",
      "sendpulse.com",
      "mailgun.org",
      "postmark.com",
      "sendwithus.com",
      "mandrill.com",
      "sparkpost.com",
      "elasticemail.com",
      "pepipost.com",
      "zoho.com",
      "mailblaze.com",
    ];

    const localPart = email.split("@")[0]!.toLowerCase();
    const domain = email.split("@")[1]?.toLowerCase() || "";

    // Check for marketing prefixes
    const hasMarketingPrefix = marketingPrefixes.some((prefix) =>
      localPart.startsWith(prefix)
    );

    if (hasMarketingPrefix) {
      reasons.push("Marketing prefix detected");
      confidence += 30;
    }

    // Check for marketing domains
    const hasMarketingDomain = marketingDomains.some((marketDomain) =>
      domain.includes(marketDomain)
    );

    if (hasMarketingDomain) {
      reasons.push("Marketing service domain");
      confidence += 50;
    }

    // Check for common patterns
    if (email.includes("noreply")) {
      reasons.push("'noreply' pattern");
      confidence += 35;
    }

    if (email.includes("newsletter")) {
      reasons.push("Newsletter address");
      confidence += 40;
    }

    if (email.includes("promo") || email.includes("promotion")) {
      reasons.push("Promotional email");
      confidence += 40;
    }

    if (email.includes("alert") || email.includes("notification")) {
      reasons.push("Alert/notification address");
      confidence += 20;
    }

    // Check for email aliases with marketing keywords
    if (email.includes("+")) {
      const alias = email.split("+")[1]?.split("@")[0]?.toLowerCase() || "";
      if (
        alias.includes("promo") ||
        alias.includes("news") ||
        alias.includes("offer")
      ) {
        reasons.push("Marketing alias detected");
        confidence += 25;
      }
    }

    return {
      isMarketing: confidence >= 30,
      confidence: Math.min(confidence, 100),
      reasons,
    };
  }

  /**
   * Analyzes name for marketing patterns.
   */
  private isMarketingName(name: string): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    const lowerName = name.toLowerCase();

    // Marketing-related names
    const marketingPatterns = [
      /newsletter/i,
      /marketing/i,
      /promotions?/i,
      /sales/i,
      /support/i,
      /noreply/i,
      /alerts?/i,
      /notifications?/i,
      /updates?/i,
      /announcements?/i,
      /no.?reply/i,
      /do.?not.?reply/i,
      /unsubscribe/i,
      /automated/i,
      /system/i,
      /postmaster/i,
      /mailer/i,
      /bounce/i,
      /webmaster/i,
      /helpdesk/i,
      /ticketing/i,
    ];

    marketingPatterns.forEach((pattern) => {
      if (pattern.test(lowerName)) {
        reasons.push(`Pattern: ${pattern.source}`);
        confidence += 20;
      }
    });

    // All caps (common for automated emails)
    if (lowerName !== name && /^[A-Z\s]+$/.test(name)) {
      reasons.push("All caps name (automated)");
      confidence += 15;
    }

    return {
      isMarketing: confidence >= 20,
      confidence: Math.min(confidence, 100),
      reasons,
    };
  }

  /**
   * Analyzes contact for marketing patterns.
   */
  private isMarketingContact(contact: Person): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Check email
    if (contact.emailAddresses?.[0]?.value) {
      const emailAnalysis = this.isMarketingEmail(
        contact.emailAddresses[0].value
      );
      if (emailAnalysis.isMarketing) {
        confidence += emailAnalysis.confidence * 0.6;
        reasons.push(...emailAnalysis.reasons);
      }
    }

    // Check name
    const name = contact.names?.[0]?.displayName || "";
    if (name) {
      const nameAnalysis = this.isMarketingName(name);
      if (nameAnalysis.isMarketing) {
        confidence += nameAnalysis.confidence * 0.4;
        reasons.push(...nameAnalysis.reasons);
      }
    }

    // Heuristic: No phone, no organization, only email = likely marketing
    if (
      !contact.phoneNumbers &&
      !contact.organizations &&
      contact.emailAddresses?.length
    ) {
      confidence += 15;
      reasons.push("No phone/organization (email-only)");
    }

    // Heuristic: Multiple email addresses = potential mailing list
    if (contact.emailAddresses && contact.emailAddresses.length > 2) {
      confidence += 10;
      reasons.push("Multiple email addresses");
    }

    return {
      isMarketing: confidence >= 30,
      confidence: Math.min(confidence, 100),
      reasons: [...new Set(reasons)],
    };
  }

  /**
   * Detects marketing contacts using email patterns, name patterns, and heuristics.
   */
  async detectMarketingContacts(
    contacts: Person[]
  ): Promise<{
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      detectionReasons: string[];
      confidence: number;
    }[];
    totalContacts: number;
    marketingContacts: number;
  }> {
    const marketingContacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      detectionReasons: string[];
      confidence: number;
    }[] = [];

    contacts.forEach((contact) => {
      const analysis = this.isMarketingContact(contact);

      if (analysis.isMarketing) {
        marketingContacts.push({
          resourceName: contact.resourceName || "",
          displayName: contact.names?.[0]?.displayName || "Unknown",
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          detectionReasons: analysis.reasons,
          confidence: analysis.confidence,
        });
      }
    });

    // Sort by confidence descending
    marketingContacts.sort((a, b) => b.confidence - a.confidence);

    return {
      contacts: marketingContacts,
      totalContacts: contacts.length,
      marketingContacts: marketingContacts.length,
    };
  }
}
