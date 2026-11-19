// Keep the private invitation in the browser until the owner submits the form.
const invitation = document.getElementById('invitation');
const key = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(key)) {
  invitation.value = key;
  history.replaceState(null, '', location.pathname + location.search);
}
