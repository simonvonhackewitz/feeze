var eventSource;
function startEventSource(reason)
{
  if (eventSource != null)
  {
    eventSource.close();
    eventSource = null;
  }
  eventSource = new EventSource("/events?sessionid=" + sessionId + "&reason=" + reason);

  // in case of error, blur background
  // restart eventsource
  eventSource.onerror = function (e)
  {
    document.body.style.opacity = 0.5;
    try
    {
      eventSource.close();
    } catch {

    }
    // previous restart reason of eventsource was error
    // delaying reconnect
    if (reason === 'error')
    {
      setTimeout(() =>
      {
        startEventSource('error');
      }, 2000);
    } else
    {
      startEventSource('error');
    }
  };

  eventSource.onmessage = function (e)
  {
    console.debug('received unexpected event: ' + JSON.stringify(e));
  }

  // get rid of error in console of firefox when reloading page
  window.onbeforeunload = function ()
  {
    eventSource.close();
  };

  eventSource.onopen = function ()
  {
    document.body.style.opacity = 1;
    console.debug('opened eventsource /events');
    // refetch contents, we might be logged in
    if (window.location.href.indexOf("?originalsessionid") > 0)
    {
      postXHR('/contents', new FormData());
    }
  }

  eventSource.addEventListener('content', async function (e)
  {
    document.getElementById("content").innerHTML = e.data;
    var origIx = window.location.href.indexOf("?originalsessionid")
    if (origIx > 0)
    {
      // erase session id from displayed URL as a poor measure against
      // session hijacking. Ideas to not display this in the first
      // place welcome!
      var newHref = window.location.href.substring(0, origIx);
      window.history.pushState({}, window.title, newHref);
    }
    if (window.location.hash)
      {
        scrollToAnchor();
      }
    else
      {
        window.scrollTo(0, 0);
      }
    initAceEditor();
    setLinks();
    await initCodeOutput();
    initIFrameEmbed();
    setTitle();
    initScripts();
  });

  eventSource.addEventListener('isLoggedIn', function (e)
  {
    setLoginHeader(e.data);
  });

  eventSource.addEventListener('isNotLoggedIn', function (e)
  {
    setLoginHeader(null);
  });

  eventSource.addEventListener('playgroundReady', function ()
  {

    document.querySelector('body').innerHTML = 'You will be redirected shortly...';
    // wait for traefik to set up routing
    // there is no easy way I know of to know when traefik is finished
    // but 4sec should be enough.
    setTimeout(function ()
    {
      window.location.href = `https://${location.hostname}:8765/?folder=vscode-remote%3A%2F%2F${location.hostname}%3A8765%2Fhome%2Fworkspace`;
    }, 4000);

  });

  eventSource.addEventListener('playgroundFailed', function ()
  {
    window.alert('Failure launching playground.');
  });

  eventSource.addEventListener('pushElementContents', function (e)
  {
    var l1 = e.data.indexOf('\n');
    var element = e.data.slice(0, l1);
    var value = e.data.slice(l1 + 1);
    var el = document.getElementById(element);
    if (el != null)  // we might have moved to another page meanwhile and no longer find element
    {
      setComputerOutputAsync(el, value);
      if (element == "content")
      {
        window.scrollTo(0, 0);
      }
    }
  });

  eventSource.addEventListener('pushHistory', function (e)
  {
    // NYI: does nothing for now, pushHistory is done in gotoPage() instead. Might remove this event
  });
}
startEventSource("new");

window.addEventListener('popstate', function (e)
{
  gotoPageNoHistory(window.location.pathname);
});


async function setComputerOutputAsync(el, value)
{
  await loadScriptAsync('/external/ansi_up.js');
  var textArea = document.createElement('textarea');
  textArea.innerHTML = value;
  value = textArea.value;
  const ansiUp = new AnsiUp();
  ansiUp.use_classes = true;
  el.innerHTML = ansiUp.ansi_to_html(value).replaceAll('\n', '<br />');
}

function formInputs(formid)
{
  var data = new FormData();
  const form = document.forms[formid];
  const formInputs = form.getElementsByTagName("input");
  for (let input of formInputs)
  {
    if (input.name && input.name.length !== 0)
    {
      data.append(input.name, input.value);
    }
  }
  const formTextAreas = form.getElementsByTagName("textarea");
  for (let input of formTextAreas)
  {
    if (input.name && input.name.length !== 0)
    {
      data.append(input.name, input.value);
    }
  }
  return data;
}

function postXHR(cmd, data)
{
  const idx = document.styleSheets[0].insertRule("body,a{cursor:wait !important;}");
  return new Promise((resolve, reject) =>
  {
    data.append('sessionid', sessionId);
    var xhr = new XMLHttpRequest();
    xhr.onload = function ()
    {
      if (this.status === 500)
      {
        window.location.reload(false);
      }
      if (this.status === 403)
      {
        window.alert('Please log in to use this feature.');
      }
      this.status < 300 ? resolve() : reject();
    };
    xhr.onerror = function ()
    {
      window.location.reload(false);
      reject();
    }
    xhr.open('POST', cmd, true);
    xhr.send(data);
  })
    .finally(() => document.styleSheets[0].deleteRule(idx))
}

function mylogin()
{
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/login', true);
  xhr.onload = function ()
  {
    var u = null;
    if (this.responseText == "not logged in")
    { // this is the status afer '/logout', should not happen here.
      alert("Not logged in.");
    }
    else if (this.responseText == "failed")
    {
      gotoPageNoHistory("/lost_password");
    }
    else
    {
      var u = this.responseText;
      if (u.startsWith("ok: "))
      {
        u = u.substring(4);
      }
    }
    setLoginHeader(u);
  };
  const data = formInputs("loginform");
  data.append('sessionid', sessionId);
  xhr.send(data);
  return false;
}

function setLoginHeader(user)
{
  if (user == null)
  {
    h = loginHeader;
    user = "";
  }
  else
  {
    h = loggedInHeader;
    user = "<b>" + user + "&nbsp;</b>";
  }
  document.getElementById("loginStatus").innerHTML = h;
  document.getElementById("status0").innerHTML = user;
}

function mylogout()
{
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/logout', true);
  const data = formInputs("logoutform");
  data.append('sessionid', sessionId);
  xhr.send(data);
  setLoginHeader(null);

  return false;
}

// for all inner links (elements with tag "a") within document, add
// onclick and onauxclick handlers.  onclick uses gotoPage() to reload
// inner part of page, while onauxclick will open a clone of the current
// session in a new window.
function setLinks()
{
  links = document.querySelectorAll("a:not(svg a)");
  me = document.URL;
  meorigin = new URL(me).origin;
  for (i = 0; i < links.length; i++)
  {
    let l = links[i];
    let hr = l.href;
    let dir = hr.slice(hr.lastIndexOf("/"));
    let ext = dir.slice(dir.lastIndexOf("."));
    // external links and links for internal docs should be skipped
    if (hr.startsWith(meorigin) && l.target !== "_blank" && ext !== ".pdf")
    {
      l.onclick = function (e)
      {
        var path = new URL(hr).pathname; // hr.substring(meorigin.length);
        gotoPage(path);
      }
      l.onauxclick = function (e)
      {
        if (e.button == 1)
        {
          e.preventDefault();
          // clone current session:
          var w = window.open(hr + "?originalsessionid=" + sessionId, '_blank');
          w.focus();
          return false;
        }
        return true;
      }
    }
    l.oncontextmenu = function (e)
    {
      if (e.button == 1)
      {
        e.preventDefault();
      }
    }
  }
}

function gotoPageNoHistory(p)
{
  var data = new FormData();
  data.append('page', p);
  return postXHR('/goto', data);
}

function gotoPage(p)
{
  // try extracting p from href
  if (this.event && this.event.currentTarget && this.event.currentTarget.href)
  {
    this.event.preventDefault();
    const url = new URL(this.event.currentTarget.href);
    p = url.pathname + url.searchParams + url.hash;
    gotoPageNoHistory(url.pathname)
      .then(_ => {
        history.pushState("loaded" /* NYI: what should this be? */,
          "feeze.dev" + p /* NYI: I see no effect of this, should set title? */,
          p /* at least, this works, p is pushed to the history, so back button works */);
        if (window.location.hash)
        {
          scrollToAnchor();
        }
      });
  }
  return false;
}

function doRegister()
{
  this.event.preventDefault();
  this.event.target.hidden = true;
  fetch('/register', {
    method: 'POST',
    body: new FormData(this.event.target)
  }).then((response) =>
  {
    response.text().then(text =>
    {
      document.getElementById("content").innerHTML = text;
    },
      () =>
      {
        document.getElementById("content").innerHTML = 'unexpected error';
      })
  });
}

function deleteAccount()
{
  this.event.preventDefault();
  this.event.target.hidden = true;
  fetch('/delete_account', {
    method: 'POST',
    body: new FormData(this.event.target)
  }).then((response) =>
  {
    response.text().then(text =>
    {
      document.getElementById("content").innerHTML = text;
    },
      () =>
      {
        document.getElementById("content").innerHTML = 'unexpected error';
      })
  });
}

function loadScriptAsync(src, onLoad)
{
  window.scriptQueue = window.scriptQueue || {};
  window.scriptQueue[src] = window.scriptQueue[src] || [];
  return new Promise((resolve) =>
  {
    if (document.querySelectorAll(`script[src="${src}"][data-loaded="true"]`).length > 0)
    {
      return resolve();
    }
    if (document.querySelectorAll(`script[src="${src}"]`).length > 0)
    {
      window.scriptQueue[src].push(resolve);
      return;
    }
    const script = document.createElement('script');
    script.onload = function ()
    {
      if (onLoad)
      {
        onLoad();
      }
      script.setAttribute('data-loaded', 'true');
      resolve();
      window.scriptQueue[src].forEach(resolve =>
      {
        return resolve();
      });
    };
    script.src = src;
    document.head.appendChild(script);
  })
}

function scrollToAnchor()
{
  const elementId = location.hash.substring(1);
  if (!!elementId)
  {
    document.getElementById(elementId)?.scrollIntoView({
      behavior: 'instant'
    });
  }
}

function initIFrameEmbed()
{
  var iframe = document.getElementById("iframe-embedded-content");
  if (iframe)
  {
    const iFrameContent = iframe.attributes['data-src-doc-content'].value
      .replaceAll('REPLACEDHTMLQUOTE', '&quot;')
      .replaceAll('REPLACEDDOUBLEQUOTE', '"');
    iframe.srcdoc = iFrameContent;
  }
}

function setTitle()
{
  const navTitle = document.querySelector('.nav-title');
  const title = navTitle
                  ? navTitle.textContent.replace(/[\r\n]/g, '').split(' • ').reverse().join(' • ')
                  : "Feeze Scheduler Tracer";

  document.title = title;
}

// explicitly load scripts which are inserted via
// document.getElementById("content").innerHTML =
// see:
// https://www.danielcrabtree.com/blog/25/gotchas-with-dynamically-adding-script-tags-to-html
function initScripts()
{
  [...document
    .getElementById("content")
    .getElementsByTagName("script")]
    .forEach(s =>
    {
      // remove already existing same scripts
      [...document.body.children].forEach(c =>
      {
        if (c.src === s.src)
        {
          c.remove();
        }
      });
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src = s.src;
      document.body.appendChild(script);
    });
}

setLinks();
setLoginHeader(null);
initIFrameEmbed();
setTitle();
