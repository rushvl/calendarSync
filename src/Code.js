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
  let latestSuccessfulMessageId = lastId;
  let hasFailedMessage = false;
  let messageCount = 0;
  
  // Load processed list & retry counts to prevent duplicates & infinite loops
  let processedIdsProps = props.getProperty('PROCESSED_MESSAGE_IDS');
  let processedIds = processedIdsProps ? JSON.parse(processedIdsProps) : [];
  
  let retryProps = props.getProperty('RETRY_COUNTS');
  let retryCounts = retryProps ? JSON.parse(retryProps) : {};
  
  for (const line of lines) {
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch(e) { continue; }
    
    // We only care about actual messages
    if (msg.event !== "message") continue;
    
    messageCount++;
    console.log(`[!] Found a new message! Title: "${msg.title || 'No Title'}"`);
    
    let success = false;
    
    // Check if already processed
    if (msg.id && processedIds.includes(msg.id)) {
      console.log(`Notification ${msg.id} was already successfully processed. Skipping.`);
      success = true;
    } else if (msg.id && retryCounts[msg.id] >= 5) {
      console.error(`Notification ${msg.id} has failed processing 5 times. Skipping permanently to avoid queue blocking.`);
      success = true; // Treat as success to let queue advance
      processedIds.push(msg.id);
    } else {
      success = processMessage(msg);
      if (success) {
        if (msg.id) {
          processedIds.push(msg.id);
          delete retryCounts[msg.id]; // Reset retry count on success
        }
      } else {
        if (msg.id) {
          retryCounts[msg.id] = (retryCounts[msg.id] || 0) + 1;
        }
        hasFailedMessage = true;
      }
    }
    
    // If this message succeeded and we haven't hit any failure yet, we can advance the last ID
    if (success && !hasFailedMessage && msg.id) {
      latestSuccessfulMessageId = msg.id;
    }
  }
  
  if (messageCount === 0) {
    console.log("No valid 'message' events were found in the response.");
  } else {
    console.log(`Finished processing ${messageCount} new message(s).`);
  }
  
  // Prune processed ID history to keep it under 100 entries (to save Script Properties space)
  if (processedIds.length > 100) {
    processedIds = processedIds.slice(processedIds.length - 100);
  }
  
  props.setProperty('PROCESSED_MESSAGE_IDS', JSON.stringify(processedIds));
  props.setProperty('RETRY_COUNTS', JSON.stringify(retryCounts));
  
  // Save the latest successful consecutive message ID so we don't process these again
  if (latestSuccessfulMessageId && latestSuccessfulMessageId !== lastId) {
    props.setProperty('LAST_MESSAGE_ID', latestSuccessfulMessageId);
  }
}

function resolveActions(msg) {
  let text = msg.message || "";
  const actions = msg.actions;
  
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return text;
  }
  
  // Replace <LABEL> placeholders case-insensitively
  for (const action of actions) {
    if (action.label && action.url) {
      const escapedLabel = action.label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`<${escapedLabel}>`, 'gi');
      text = text.replace(regex, action.url);
    }
  }
  
  // Also append action links at the bottom to ensure Gemini sees them clearly
  text += "\n\n--- Attached Links ---";
  for (const action of actions) {
    if (action.url) {
      text += `\n${action.label || 'Link'}: ${action.url}`;
    }
  }
  
  return text;
}

function processMessage(msg) {
  const title = msg.title || ""; 
  const processedBody = resolveActions(msg);
  
  // Combine title, message, and any attachments/links to send to Gemini
  const fullText = `Title: ${title}\nBody:\n${processedBody}\nLink/Action: ${msg.click || ""}`;
  
  console.log("Sending message to Gemini for parsing...");
  const extractedData = extractWithGemini(fullText);
  
  if (!extractedData) {
    console.error("Failed to extract data or Gemini API returned an error.");
    return false;
  }
  
  if (!extractedData.hasDateTime) {
    console.log("Skipping: Gemini determined the notification does NOT contain a valid date/time or deadline.");
    return true;
  }
  
  console.log(`Gemini extraction successful! Event Name: "${extractedData.title}". Adding to Calendar...`);
  return addToCalendar(extractedData);
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
  
  let response;
  let attempts = 0;
  const maxAttempts = 3;
  let delay = 1000; // Initial delay of 1 second
  
  while (attempts < maxAttempts) {
    try {
      response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      if (responseCode === 200) {
        break;
      }
      
      console.warn(`Gemini API attempt ${attempts + 1} failed with response code ${responseCode}. Response: ${response.getContentText()}`);
      
      // Retry on 503 (Unavailable), 429 (Rate Limit / Resource Exhausted), or 500 (Internal Server Error)
      if (responseCode !== 503 && responseCode !== 429 && responseCode !== 500) {
        return null;
      }
    } catch (e) {
      console.warn(`Gemini API attempt ${attempts + 1} failed with network/fetch error: ${e.toString()}`);
    }
    
    attempts++;
    if (attempts < maxAttempts) {
      console.log(`Waiting ${delay}ms before retrying...`);
      Utilities.sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
  
  if (!response || response.getResponseCode() !== 200) {
    if (response) {
      console.error("Gemini API error after all retries: " + response.getContentText());
    } else {
      console.error("Gemini API error: Request failed completely.");
    }
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
    return false;
  }
  
  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);
  
  const options = {
    description: data.description
  };
  if (data.location) {
    options.location = data.location;
  }
  
  try {
    cal.createEvent(data.title, startTime, endTime, options);
    console.log(`Success! Created event: ${data.title} at ${startTime}`);
    return true;
  } catch (e) {
    console.error("Failed to create event in calendar: " + e);
    return false;
  }
}

