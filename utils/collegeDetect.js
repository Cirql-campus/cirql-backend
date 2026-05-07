'use strict';

/**
 * College domain → name map.
 * Add new colleges here as CirQl expands.
 */
const COLLEGE_MAP = [
  // Existing & Key NCR
  { domain: 'kiet.edu',       name: 'KIET Group of Institutions' },
  { domain: 'akgec.ac.in',    name: 'AKGEC Ghaziabad' },
  { domain: 'gl.ac.in',       name: 'Galgotias University' },
  { domain: 'hbtu.ac.in',     name: 'HBTU Kanpur' },
  { domain: 'dtu.ac.in',      name: 'Delhi Technological University (DTU)' },
  { domain: 'nsut.ac.in',     name: 'NSUT Delhi' },
  { domain: 'igdtuw.ac.in',   name: 'IGDTUW Delhi' },
  { domain: 'jiit.ac.in',     name: 'JIIT Noida' },
  { domain: 'amity.edu',      name: 'Amity University' },
  { domain: 'iiitd.ac.in',    name: 'IIIT Delhi' },
  { domain: 'bvcoend.ac.in',  name: 'Bharati Vidyapeeth College of Engineering' },
  { domain: 'ipec.org.in',    name: 'IPEC Ghaziabad' },
  { domain: 'abesit.in',      name: 'ABES Institute of Technology' },
  { domain: 'abes.ac.in',     name: 'ABES Engineering College' },
  { domain: 'niet.co.in',     name: 'NIET Greater Noida' },
  { domain: 'gniot.net.in',   name: 'GNIOT Greater Noida' },
  { domain: 'jssaten.ac.in',  name: 'JSS Academy Noida' },
  { domain: 'mait.ac.in',     name: 'MAIT Delhi' },
  { domain: 'msit.in',        name: 'MSIT Delhi' },
  { domain: 'bpitindia.com',  name: 'BPIT Delhi' },
  { domain: 'its.edu.in',     name: 'I.T.S Education Group (Engineering, Dental, Management)' },
  { domain: 'imsec.ac.in',    name: 'IMS Engineering College' },
  { domain: 'galgotiascollege.edu', name: 'Galgotias College of Engineering' },
  { domain: 'glbitm.org',     name: 'GL Bajaj Institute of Technology and Management' },
  { domain: 'kccitm.edu.in',  name: 'KCC Institute of Technology' },
  { domain: 'ipu.ac.in',      name: 'Guru Gobind Singh Indraprastha University (GGSIPU)' },
  { domain: 'du.ac.in',       name: 'Delhi University (DU)' },
  { domain: 'jnu.ac.in',      name: 'Jawaharlal Nehru University (JNU)' },
  { domain: 'jmi.ac.in',      name: 'Jamia Millia Islamia' },
  { domain: 'snu.edu.in',     name: 'Shiv Nadar University' },
  { domain: 'sharda.ac.in',   name: 'Sharda University' },
  { domain: 'bmu.edu.in',     name: 'BML Munjal University' },
  
  // More Noida / Greater Noida Colleges
  { domain: 'gbu.ac.in',      name: 'Gautam Buddha University' },
  { domain: 'iimtindia.net',  name: 'IIMT Group of Colleges' },
  { domain: 'niu.edu.in',     name: 'Noida International University (NIU)' },
  { domain: 'imsnoida.in',    name: 'IMS Noida' },
  { domain: 'jimsnoida.org',  name: 'JIMS Noida' },
  { domain: 'mangalmay.org',  name: 'Mangalmay Group of Institutions' },
  { domain: 'accurate.in',    name: 'Accurate Institute of Management and Technology' },
  { domain: 'iec.edu.in',     name: 'IEC Group of Institutions' },
  { domain: 'gnindia.dronacharya.info', name: 'Dronacharya Group of Institutions' },
  { domain: 'himt.ac.in',     name: 'HIMT Group of Institutions' },
  { domain: 'iilm.edu.in',    name: 'IILM University Greater Noida' },
  { domain: 'scmsnoida.ac.in',name: 'Symbiosis Centre for Management Studies (SCMS) Noida' },
  { domain: 'slsnoida.edu.in',name: 'Symbiosis Law School (SLS) Noida' },
  { domain: 'aaft.com',       name: 'Asian Academy of Film and Television (AAFT)' },
  { domain: 'united.ac.in',   name: 'United Group of Institutions (Noida)' },
  { domain: 'lloydlawcollege.edu.in', name: 'Lloyd Law College' },
  { domain: 'lloydinstitute.org',     name: 'Lloyd Institute of Engineering & Technology' },
  { domain: 'lloydbusinessschool.edu.in', name: 'Lloyd Business School' },
  { domain: 'gims.net.in',            name: 'GNIOT Institute of Management Studies' },
  { domain: 'glbimr.org',             name: 'GL Bajaj Institute of Management and Research' },
  { domain: 'asb.edu.in',             name: 'Asian School of Business (ASB) Noida' },
  { domain: 'apeejay.edu',            name: 'Apeejay Institute of Technology' },
  { domain: 'itsdentalcollege.com',   name: 'I.T.S Dental College Greater Noida' },
  { domain: 'hierank.org',            name: 'Hierank Business School Noida' },
  { domain: 'jaipuria.ac.in',         name: 'Jaipuria Institute of Management Noida' },
  { domain: 'fddiindia.com',          name: 'Footwear Design and Development Institute (FDDI) Noida' },
  { domain: 'inmantec.edu',           name: 'INMANTEC Institutions' },


  // IITs
  { domain: 'iitd.ac.in',     name: 'IIT Delhi' },
  { domain: 'iitb.ac.in',     name: 'IIT Bombay' },
  { domain: 'iitk.ac.in',     name: 'IIT Kanpur' },
  { domain: 'iitm.ac.in',     name: 'IIT Madras' },
  { domain: 'iitkgp.ac.in',   name: 'IIT Kharagpur' },
  { domain: 'iitr.ac.in',     name: 'IIT Roorkee' },
  { domain: 'iitg.ac.in',     name: 'IIT Guwahati' },
  { domain: 'iith.ac.in',     name: 'IIT Hyderabad' },
  { domain: 'iitgn.ac.in',    name: 'IIT Gandhinagar' },
  { domain: 'iitrpr.ac.in',   name: 'IIT Ropar' },
  { domain: 'iitp.ac.in',     name: 'IIT Patna' },
  { domain: 'iitbbs.ac.in',   name: 'IIT Bhubaneswar' },
  { domain: 'iitj.ac.in',     name: 'IIT Jodhpur' },
  { domain: 'iitmandi.ac.in', name: 'IIT Mandi' },
  { domain: 'iiti.ac.in',     name: 'IIT Indore' },
  { domain: 'iitbhu.ac.in',   name: 'IIT (BHU) Varanasi' },
  { domain: 'iitpkd.ac.in',   name: 'IIT Palakkad' },
  { domain: 'iittp.ac.in',    name: 'IIT Tirupati' },
  { domain: 'iitism.ac.in',   name: 'IIT (ISM) Dhanbad' },
  { domain: 'iitbhilai.ac.in',name: 'IIT Bhilai' },
  { domain: 'iitgoa.ac.in',   name: 'IIT Goa' },
  { domain: 'iitjammu.ac.in', name: 'IIT Jammu' },
  { domain: 'iitdh.ac.in',    name: 'IIT Dharwad' },

  // NITs
  { domain: 'nitt.edu',       name: 'NIT Trichy' },
  { domain: 'nitk.ac.in',     name: 'NIT Surathkal' },
  { domain: 'nitrkl.ac.in',   name: 'NIT Rourkela' },
  { domain: 'nitw.ac.in',     name: 'NIT Warangal' },
  { domain: 'mnit.ac.in',     name: 'MNIT Jaipur' },
  { domain: 'vnit.ac.in',     name: 'VNIT Nagpur' },
  { domain: 'nitc.ac.in',     name: 'NIT Calicut' },
  { domain: 'mnnit.ac.in',    name: 'MNNIT Allahabad' },
  { domain: 'nitkkr.ac.in',   name: 'NIT Kurukshetra' },
  { domain: 'nits.ac.in',     name: 'NIT Silchar' },
  { domain: 'nitdgp.ac.in',   name: 'NIT Durgapur' },
  { domain: 'nitj.ac.in',     name: 'NIT Jalandhar' },
  { domain: 'svnit.ac.in',    name: 'SVNIT Surat' },
  { domain: 'nitm.ac.in',     name: 'NIT Meghalaya' },
  { domain: 'manit.ac.in',    name: 'MANIT Bhopal' },
  { domain: 'nitrr.ac.in',    name: 'NIT Raipur' },
  { domain: 'nita.ac.in',     name: 'NIT Agartala' },
  { domain: 'nitgoa.ac.in',   name: 'NIT Goa' },
  { domain: 'nitjsr.ac.in',   name: 'NIT Jamshedpur' },
  { domain: 'nitp.ac.in',     name: 'NIT Patna' },
  { domain: 'nith.ac.in',     name: 'NIT Hamirpur' },
  { domain: 'nitpy.ac.in',    name: 'NIT Puducherry' },
  { domain: 'nitsri.ac.in',   name: 'NIT Srinagar' },
  { domain: 'nituk.ac.in',    name: 'NIT Uttarakhand' },
  { domain: 'nitdelhi.ac.in', name: 'NIT Delhi' },
  { domain: 'nitmz.ac.in',    name: 'NIT Mizoram' },
  { domain: 'nitnagaland.ac.in', name: 'NIT Nagaland' },
  { domain: 'nitsikkim.ac.in',name: 'NIT Sikkim' },
  { domain: 'nitap.ac.in',    name: 'NIT Arunachal Pradesh' },
  { domain: 'nitmanipur.ac.in',name: 'NIT Manipur' },
  { domain: 'nitandhra.ac.in',name: 'NIT Andhra Pradesh' }
];

/** Build a fast Set from the env var (runtime-configurable) */
const envDomains = new Set(
  (process.env.ALLOWED_COLLEGE_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * @param {string} email
 * @returns {{ college: string, domain: string } | null}
 */
const detectCollege = (email) => {
  if (!email || typeof email !== 'string') return null;
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at === -1) return null;
  const domain = lower.slice(at + 1);

  // Check against known map first
  const found = COLLEGE_MAP.find(
    e => domain === e.domain || domain.endsWith('.' + e.domain)
  );
  if (found) return { college: found.name, domain: found.domain };

  // Check env-supplied allow-list
  for (const allowed of envDomains) {
    if (domain === allowed || domain.endsWith('.' + allowed)) {
      const label = allowed.split('.')[0];
      return {
        college: label.charAt(0).toUpperCase() + label.slice(1) + ' University',
        domain:  allowed,
      };
    }
  }

  // Accept any *.edu or *.ac.in generically
  if (domain.endsWith('.edu') || domain.endsWith('.ac.in')) {
    const label = domain.split('.')[0];
    return {
      college: label.charAt(0).toUpperCase() + label.slice(1) + ' University',
      domain,
    };
  }

  return null;
};

const isCollegeEmail = (email) => detectCollege(email) !== null;

module.exports = { detectCollege, isCollegeEmail, COLLEGE_MAP };
