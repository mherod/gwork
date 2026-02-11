/**
 * Contact matching and duplicate detection/merge operations.
 * Handles finding duplicate contacts and merging them.
 */

import { validateConfidenceScore } from "./validators.ts";
import type { Person } from "../types/google-apis.ts";

export class ContactMatcher {
  /**
   * Calculates Levenshtein distance between two strings.
   * Used for fuzzy name matching in duplicate detection.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len1; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1
          );
        }
      }
    }

    return matrix[len2]![len1]!;
  }

  /**
   * Normalizes name for comparison (lowercase, trim, remove special chars).
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "");
  }

  /**
   * Calculates name similarity percentage (0-100).
   */
  calculateNameSimilarity(name1: string, name2: string): number {
    const normalized1 = this.normalizeName(name1);
    const normalized2 = this.normalizeName(name2);

    if (normalized1 === normalized2) {
      return 100;
    }

    const maxLen = Math.max(normalized1.length, normalized2.length);
    if (maxLen === 0) return 0;

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const similarity = ((maxLen - distance) / maxLen) * 100;

    return Math.round(similarity);
  }

  /**
   * Extracts primary email from contact.
   */
  getContactEmail(contact: Person): string | null {
    return contact.emailAddresses?.[0]?.value?.toLowerCase() || null;
  }

  /**
   * Extracts primary phone from contact (digits only).
   */
  getContactPhone(contact: Person): string | null {
    return contact.phoneNumbers?.[0]?.value?.replace(/\D/g, "") || null;
  }

  /**
   * Extracts display name from contact.
   */
  getContactName(contact: Person): string | null {
    return contact.names?.[0]?.displayName || null;
  }

  /**
   * Finds duplicate contacts using email, phone, and name matching.
   * Requires external listContacts function to fetch contacts.
   */
  async findDuplicates(
    contacts: Person[],
    options: {
      criteria?: string[];
      threshold?: number;
    } = {}
  ): Promise<{
    duplicates: {
      type: string;
      value: string;
      confidence: number;
      contacts: Person[];
    }[];
    totalDuplicates: number;
    totalContacts: number;
  }> {
    const {
      criteria = ["email", "phone", "name"],
      threshold = 80,
    } = options;

    // Validate inputs
    if (threshold < 0 || threshold > 100) {
      validateConfidenceScore(threshold);
    }

    if (contacts.length === 0) {
      return {
        duplicates: [],
        totalDuplicates: 0,
        totalContacts: 0,
      };
    }

    const duplicateGroups: {
      type: string;
      value: string;
      confidence: number;
      contacts: Person[];
    }[] = [];

    const processedPairs = new Set<string>();

    // Phase 1: Exact email matches (100% confidence)
    if (criteria.includes("email")) {
      const emailMap = new Map<string, Person[]>();

      contacts.forEach((contact) => {
        const email = this.getContactEmail(contact);
        if (email) {
          if (!emailMap.has(email)) {
            emailMap.set(email, []);
          }
          emailMap.get(email)!.push(contact);
        }
      });

      emailMap.forEach((emailContacts, email) => {
        if (emailContacts.length > 1) {
          const key = emailContacts.map((c) => c.resourceName).sort().join("|");
          if (!processedPairs.has(key)) {
            duplicateGroups.push({
              type: "email",
              value: email,
              confidence: 100,
              contacts: emailContacts,
            });
            processedPairs.add(key);
          }
        }
      });
    }

    // Phase 2: Exact phone matches (100% confidence)
    if (criteria.includes("phone")) {
      const phoneMap = new Map<string, Person[]>();

      contacts.forEach((contact) => {
        const phone = this.getContactPhone(contact);
        if (phone && phone.length >= 7) {
          if (!phoneMap.has(phone)) {
            phoneMap.set(phone, []);
          }
          phoneMap.get(phone)!.push(contact);
        }
      });

      phoneMap.forEach((phoneContacts, phone) => {
        if (phoneContacts.length > 1) {
          const key = phoneContacts.map((c) => c.resourceName).sort().join("|");
          if (!processedPairs.has(key)) {
            duplicateGroups.push({
              type: "phone",
              value: phone,
              confidence: 100,
              contacts: phoneContacts,
            });
            processedPairs.add(key);
          }
        }
      });
    }

    // Phase 3: Fuzzy name matching
    if (criteria.includes("name")) {
      for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
          const contact1 = contacts[i]!;
          const contact2 = contacts[j]!;

          const key = [contact1.resourceName, contact2.resourceName]
            .sort()
            .join("|");
          if (processedPairs.has(key)) {
            continue;
          }

          const name1 = this.getContactName(contact1);
          const name2 = this.getContactName(contact2);

          if (name1 && name2) {
            const similarity = this.calculateNameSimilarity(name1, name2);

            if (similarity >= threshold) {
              const group = [contact1, contact2];
              const confidence = similarity;

              duplicateGroups.push({
                type: "name",
                value: name1,
                confidence: Math.round(confidence),
                contacts: group,
              });
              processedPairs.add(key);
            }
          }
        }
      }
    }

    // Sort by confidence (descending)
    duplicateGroups.sort((a, b) => b.confidence - a.confidence);

    return {
      duplicates: duplicateGroups,
      totalDuplicates: duplicateGroups.length,
      totalContacts: contacts.length,
    };
  }

  /**
   * Builds merged person data from multiple contacts.
   * This prepares the data; the caller handles the API update.
   */
  prepareMergeData(targetContact: Person, sourceContacts: Person[]): Partial<Person> {
    const mergedData: Partial<Person> = { ...targetContact };

    // Merge emails
    const emails = new Set<string>();
    if (targetContact.emailAddresses) {
      targetContact.emailAddresses.forEach((e) => {
        if (e.value) emails.add(e.value);
      });
    }
    sourceContacts.forEach((c) => {
      c.emailAddresses?.forEach((e) => {
        if (e.value) emails.add(e.value);
      });
    });

    if (emails.size > 0) {
      mergedData.emailAddresses = Array.from(emails).map((email, idx) => ({
        value: email,
        metadata: { primary: idx === 0 },
      }));
    }

    // Merge phones
    const phones = new Set<string>();
    if (targetContact.phoneNumbers) {
      targetContact.phoneNumbers.forEach((p) => {
        if (p.value) phones.add(p.value);
      });
    }
    sourceContacts.forEach((c) => {
      c.phoneNumbers?.forEach((p) => {
        if (p.value) phones.add(p.value);
      });
    });

    if (phones.size > 0) {
      mergedData.phoneNumbers = Array.from(phones).map((phone, idx) => ({
        value: phone,
        metadata: { primary: idx === 0 },
      }));
    }

    // Merge addresses
    const addresses = new Set<string>();
    if (targetContact.addresses) {
      targetContact.addresses.forEach((a) => {
        if (a.formattedValue) addresses.add(a.formattedValue);
      });
    }
    sourceContacts.forEach((c) => {
      c.addresses?.forEach((a) => {
        if (a.formattedValue) addresses.add(a.formattedValue);
      });
    });

    if (addresses.size > 0) {
      mergedData.addresses = Array.from(addresses).map((addr, idx) => ({
        formattedValue: addr,
        metadata: { primary: idx === 0 },
      }));
    }

    return mergedData;
  }
}
