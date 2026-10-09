// Profile i reguły szumu filtra słów kluczowych (W-06). JEDNA kopia dla obu źródeł.
// Przeniesione z config/etap2_filtr_pracuj_pl.js; zgodność pilnuje test/golden/filtr.test.ts.
// Nowa reguła szumu: { pattern: /\bslowo\b/i, reason: '...' }.
// Nowe słowo: keywords (frazy angielskie) albo stems (polskie rdzenie bez końcówki).

export interface Profil {
  id: string;
  name: string;
  keywords: string[];
  stems?: string[];
}

export interface RegulaSzumu {
  pattern: RegExp;
  reason: string;
}

export const PROFILES: Profil[] = [
  { id: '1', name: 'Learning & Development',
    keywords: ['Head of Learning & Development', 'L&D Director', 'L&D Manager', 'Learning and Development', 'Training Manager', 'competency framework', 'training budget', 'employee development', 'upskilling', 'coaching'],
    stems: ['szkole', 'trener', 'kompetencj', 'rozwoj pracownik', 'rozwoj kompetencj'] },
  { id: '2', name: 'Director of Operations / Operations Excellence Lead',
    keywords: ['Director of Operations', 'Operations Excellence', 'Operations Manager', 'Operations Lead', 'process standardization', 'process documentation', 'Jira', 'JQL', 'governance', 'competency matrix'],
    stems: ['operacyjn', 'doskonaleni proces', 'standaryzacj proces'] },
  { id: '3', name: 'Chief of Staff',
    keywords: ['Chief of Staff', 'Business Operations Manager', 'Strategy & Operations Manager', 'executive support', 'cross-functional coordination', 'board reporting', 'stakeholder management'],
    stems: ['biur zarzad', 'wsparci zarzad'] },
  { id: '4', name: 'Product Manager',
    keywords: ['Product Manager', 'Product Owner', 'roadmap', 'product strategy', 'backlog', 'Scrum', 'Agile', 'stakeholder management', 'customer needs', 'product lifecycle'],
    stems: ['kierownik produkt', 'wlasciciel produkt', 'strategi produktow'] },
  { id: '5', name: 'Program/Delivery Management Director (PMO Lead)',
    keywords: ['Program Manager', 'Delivery Manager', 'PMO Lead', 'Program Director', 'Portfolio Management', 'Prince2', 'delivery governance', 'project portfolio'],
    stems: ['kierownik program', 'dyrektor program', 'portfel projekt', 'kierownik dostaw'] },
  { id: '6', name: 'Head of AI Adoption / AI Transformation Lead',
    keywords: ['AI', 'Head of AI Adoption', 'AI Transformation Lead', 'AI Transformation Director', 'AI Adoption Manager', 'AI Transformation', 'AI Adoption', 'change management', 'AI strategy', 'generative AI', 'AI governance', 'AI upskilling'],
    stems: ['transformacj AI', 'wdrozeni AI', 'adopcj AI', 'zarzadzani zmian'] },
  { id: '7', name: 'AI & Process Transformation Consultant',
    keywords: ['AI', 'AI Consultant', 'AI Transformation Consultant', 'Process Consultant', 'fractional consultant', 'digital transformation advisory', 'business transformation consulting', 'business transformation', 'HR transformation', 'digital transformation', 'intelligent automation', 'AI Audit', 'AI Retainer'],
    stems: ['konsultant AI', 'konsultant proces', 'konsultant transformacj', 'transformacj cyfrow', 'transformacj biznesow'] },
  { id: '8', name: 'Vibe coder',
    keywords: ['AI', 'AI Engineer', 'AI builder', 'no-code/low-code builder', 'Python', 'Docker', 'GitHub', 'Claude Code', 'prompt engineering', 'AI tooling', 'automation scripts'],
    stems: ['inzynier AI', 'programist AI'] },
  { id: '9', name: 'Process Analytics & Automation',
    keywords: ['Process Automation', 'Automation Analyst', 'RPA', 'no-code', 'low-code', 'n8n', 'Zapier', 'Make', 'Power Automate', 'intelligent automation', 'workflow automation', 'process mining', 'business process analytics'],
    stems: ['automat', 'automatyzacj proces', 'analityk automatyzacj', 'specjalist automatyzacj'] },
  { id: 'A', name: 'Head of People Operations / People Ops Director (sygnal dodatkowy)',
    keywords: ['People Operations', 'People Ops Director', 'HR Operations', 'employee lifecycle', 'retention', 'culture', 'onboarding'],
    stems: ['dyrektor HR', 'dyrektor personaln', 'kierownik personaln'] },
  { id: 'B', name: 'Head of Talent Acquisition / Recruitment Director (sygnal dodatkowy)',
    keywords: ['Talent Acquisition', 'Recruitment Director', 'Head of Recruitment', 'sourcing', 'hiring pipeline', 'candidate experience'],
    stems: ['kierownik rekrutacj', 'dyrektor rekrutacj'] },
  { id: 'C', name: 'Head of Employer Branding / Talent Marketing (sygnal dodatkowy)',
    keywords: ['Employer Branding', 'Talent Marketing', 'recruitment marketing', 'university partnerships', 'content strategy'],
    stems: ['mark pracodawc'] },
];

export const NOISE_PATTERNS: RegulaSzumu[] = [
  { pattern: /\bsap\b/i, reason: 'SAP/ERP - znany szum z Pracuj.pl (patrz 4_plan_poszukiwania_pracy.md, pkt 4)' },
  { pattern: /\bsenior data\b/i, reason: 'Senior Data ... - rola stricte techniczna/IC (Data Engineer/Scientist/Analyst), poza profilami liderskimi/transformacyjnymi (dodane 13.09.2026)' },
  { pattern: /\bsenior backend\b/i, reason: 'Senior Backend ... - rola stricte techniczna/IC, poza profilami liderskimi/transformacyjnymi (dodane 13.09.2026)' },
  { pattern: /\bplatform engineer\b/i, reason: 'Platform Engineer - rola stricte techniczna/IC infrastrukturalna, poza profilami liderskimi/transformacyjnymi (dodane 13.09.2026)' },
  { pattern: /\bprogramista\b/i, reason: 'Programista - rola stricte techniczna/deweloperska, poza profilami liderskimi/transformacyjnymi (dodane 14.09.2026)' },
  { pattern: /\bchief technology officer\b/i, reason: 'Chief Technology Officer - rola stricte techniczna wykonawcza (CTO), poza profilami transformacyjnymi/doradczymi (dodane 18.09.2026, z recznego przegladu CSV Pracuj.pl)' },
  { pattern: /\bdata scientist\b/i, reason: 'Data Scientist - rola stricte techniczna/IC, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\bmachine learning\b/i, reason: 'Machine Learning (Engineer/...) - rola stricte techniczna/IC, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\bdata engineer\b/i, reason: 'Data Engineer - rola stricte techniczna/IC, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\bjunior\b/i, reason: 'Junior - poziom stanowiska ponizej celu kandydatki (dodane 18.09.2026)' },
  { pattern: /\bpython\b/i, reason: 'Python - rola stricte techniczna/IC. UWAGA: koliduje z profilem 8 "Vibe coder", ktory ma Python jako slowo kluczowe dopasowania - ta regula szumu wygrywa i odrzuci rowniez oferty Vibe coder wspominajace Python w tytule (dodane 18.09.2026, do przegladu)' },
  { pattern: /\bai\s*\/\s*ml\b/i, reason: 'AI/ML (Engineer/...) - rola stricte techniczna/IC, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\bwith german\b/i, reason: 'Wymagany niemiecki w ogloszeniu - poza zakresem jezykowym kandydatki (dodane 18.09.2026)' },
  { pattern: /\btest engineer\b/i, reason: 'Test Engineer - rola stricte techniczna/IC testerska, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\bpower bi\b/i, reason: 'Power BI - rola stricte techniczna/analityczna narzedziowa, poza profilami liderskimi/transformacyjnymi (dodane 18.09.2026)' },
  { pattern: /\barchitect\b/i, reason: 'Architect (Solution/Software/Enterprise/... Architect) - rola stricte techniczna/projektowa, poza profilami liderskimi/transformacyjnymi. UWAGA: regula szumu wygrywa z profilami, wiec odrzuci tez np. "AI Architect" (dodane 20.09.2026)' },
  { pattern: /\barchitek(t(a|em|owi|u|ów|ka|ki)?|ci|cie)\b/i, reason: 'Architekt (rowniez odmiany: architekta, architektem, architekci, architektka...) - rola stricte techniczna/projektowa, poza profilami liderskimi/transformacyjnymi (dodane 20.09.2026)' },
];
