$(document).ready(function() {

	$('#login').submit(function(e) {
		e.preventDefault();

		if ($('#login').hasClass('loading')) {
			return;
		}

		var data = $('form').serialize();
		var url = $('form').attr('action');

		$('#login').addClass('loading');

		$.post(url, data, function(rsp) {
			if (rsp.ok) {
				$('#login').addClass('email-sent');
				$('#login input[name="email"]').val('');
			} else {
				$('#login-response').html(rsp.error);
			}
			$('#login').removeClass('loading');
		}).fail(function() {
			$('#login-response').html('Error connecting to server.');
			$('#login').removeClass('loading');
		});
	});

});
