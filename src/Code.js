const CONFIG = {
  NTFY_TOPIC: PropertiesService.getScriptProperties().getProperty('NTFY_TOPIC'),
  NTFY_USERNAME: PropertiesService.getScriptProperties().getProperty('NTFY_USERNAME') || '',
  NTFY_PASSWORD: PropertiesService.getScriptProperties().getProperty('NTFY_PASSWORD') || '',
  CALENDAR_ID: PropertiesService.getScriptProperties().getProperty('CALENDAR_ID'),
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
};

function pollNtfy() {
  console.log("Starting poll for new notifications...");
  
  if (!CONFIG.NTFY_TOPIC || !CONFIG.CALENDAR_ID || !CONFIG.GEMINI_API_KEY) {
    console.error("Missing configuration. Please set Script Properties.");
    return;
  }
  
  const props = PropertiesService.getScriptProperties();
  const lastId = props.getProperty('LAST_MESSAGE_ID');
  
  // If first run, only get messages from the last 5 minutes. Otherwise, get messages since the last ID.
  const sinceParam = lastId ? `since=${lastId}` : `since=5m`;
  const url = `https://naarad.metakgp.org/${CONFIG.NTFY_TOPIC}/json?poll=1&${sinceParam}`;
  
  const options = { muteHttpExceptions: true };
  if (CONFIG.NTFY_USERNAME && CONFIG.NTFY_PASSWORD) {
    options.headers = {
      "Authorization": "Basic " + Utilities.base64Encode(CONFIG.NTFY_USERNAME + ":" + CONFIG.NTFY_PASSWORD)
    };
  }
  
  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch(e) {
    console.error("Error fetching from server: " + e);
    return;
  }
  
  if (response.getResponseCode() !== 200) {
    console.error("Server returned status: " + response.getResponseCode());
    return;
  }
  
  const text = response.getContentText();
  if (!text) {
    console.log("Server responded perfectly, but no new messages were found.");
    return; 
  }
  
  const lines = text.trim().split('\n');
  let latestMessageId = lastId;
  let messageCount = 0;
  
  for (const line of lines) {
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch(e) { continue; }
    
    // Track the latest message ID to prevent duplicates
    if (msg.id) {
      latestMessageId = msg.id;
    }
    
    // We only care about actual messages
    if (msg.event !== "message") continue;
    
    messageCount++;
    console.log(`[!] Found a new message! Title: "${msg.title || 'No Title'}"`);
    processMessage(msg);
  }
  
  if (messageCount === 0) {
    console.log("No valid 'message' events were found in the response.");
  } else {
    console.log(`Finished processing ${messageCount} new message(s).`);
  }
  
  // Save the latest message ID so we don't process these again
  if (latestMessageId && latestMessageId !== lastId) {
    props.setProperty('LAST_MESSAGE_ID', latestMessageId);
  }
}

function processMessage(msg) {
  const rawText = msg.message;
  const title = msg.title || ""; 
  
  // Combine title, message, and any attachments/links to send to Gemini
  const fullText = `Title: ${title}\nBody:\n${rawText}\nLink/Action: ${msg.click || ""}`;
  
  console.log("Sending message to Gemini for parsing...");
  const extractedData = extractWithGemini(fullText);
  
  if (!extractedData) {
    console.error("Failed to extract data or Gemini API returned an error.");
    return;
  }
  
  if (!extractedData.hasDateTime) {
    console.log("Skipping: Gemini determined the notification does NOT contain a valid date/time or deadline.");
    return;
  }
  
  console.log(`Gemini extraction successful! Event Name: "${extractedData.title}". Adding to Calendar...`);
  addToCalendar(extractedData);
}

function extractWithGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const currentYear = new Date().getFullYear();
  const prompt = `
You are an assistant that extracts event details from notifications.
Extract the following information from the text below. 
If the text does NOT contain enough information to determine a specific Date, set "hasDateTime" to false.

Respond ONLY with a valid JSON object (no markdown formatting, no \`\`\`json blocks) matching this schema:
{
  "hasDateTime": boolean,
  "title": string (A concise event title based on the text),
  "startTime": string (ISO 8601 format. If it is a normal event, use its start time. If the notification is about a DEADLINE or "open till" date, use that deadline as the startTime. Assume the year is ${currentYear}. Use timezone +05:30 (IST) unless specified otherwise),
  "endTime": string (ISO 8601 format. If an end time is provided, use it. If it's a deadline, set it to the exact same as startTime, or 1 hour after. If no end time is specified at all, calculate it as exactly 1 hour after startTime),
  "location": string (The mode or venue, e.g. "Online", "Room 3", or null if not found),
  "description": string (A well-formatted summary of the event. Include any relevant Links, Form links, or POC info found in the text. Add the original raw text at the bottom.)
}

Text to process:
"""
${text}
"""
`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    console.error("Gemini API error: " + response.getContentText());
    return null;
  }
  
  const data = JSON.parse(response.getContentText());
  try {
    const jsonStr = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonStr);
  } catch(e) {
    console.error("Failed to parse Gemini response: " + e);
    return null;
  }
}

function addToCalendar(data) {
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!cal) {
    console.error("Calendar not found: " + CONFIG.CALENDAR_ID);
    return;
  }
  
  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);
  
  const options = {
    description: data.description
  };
  if (data.location) {
    options.location = data.location;
  }
  
  cal.createEvent(data.title, startTime, endTime, options);
  console.log(`Success! Created event: ${data.title} at ${startTime}`);
}

