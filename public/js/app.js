function form_handler(query, callback) {
	$(query).submit(function(e) {
		e.preventDefault();

		if ($(query).hasClass('loading')) {
			return;
		}

		var data = $(query).serialize();
		var url = $(query).attr('action');

		$(query + ' .response').html('Please wait...');
		$(query).addClass('loading');

		$.post(url, data, function(rsp) {
			$(query).removeClass('loading');
			if (rsp.ok) {
				$(query + ' .response').html('');
				if (typeof callback == 'function') {
					callback(rsp);
				}
			} else {
				$(query + ' .response').html(rsp.error);
			}
		})
		.fail(function(rsp) {
			var error = 'Error connecting to server.';
			if ('responseJSON' in rsp && 'error' in rsp.responseJSON) {
				error = rsp.responseJSON.error;
			}
			$(query + ' .response').html(error);
			$(query).removeClass('loading');
		});
	});
}

function format_timestamp(el) {
	var iso_date = $(el).html();
	var nice_timestamp = moment(iso_date).format('MMM d, Y, h:mma');
	$(el).html(nice_timestamp);
}

$(document).ready(function() {

	form_handler('#login', function(rsp) {
		$('#login .response').html('Email sent, please check your inbox.');
		$('#login input[name="email"]').val('');
	});

	form_handler('#send', function(rsp) {
		$('#send .response').html('Your message has been sent.');
		$('#send textarea[name="content"]').val('');
		$.get('/api/message/' + rsp.message_id, function(rsp) {
			$('#message-list').prepend(rsp);
			format_timestamp($('#message-list .message .timestamp')[0]);
			$('#members li:eq(0)').before($('#members li.curr-person'));
		});
	});

	form_handler('#profile form', function(rsp) {
		window.location = '/' + rsp.person.slug;
	});

	$("#send #content").keyup(function(e) {
		while($(this).outerHeight() < this.scrollHeight + parseFloat($(this).css("borderTopWidth")) + parseFloat($(this).css("borderBottomWidth"))) {
			$(this).height($(this).height() + 1);
		};
	});

	if ($('#context').length > 0) {
		$('#intro').addClass('above');
		$('html, body').animate({
			scrollTop: $("#context").offset().top - 32
		}, 500);
	}

	$('.timestamp').each(function(index, el) {
		format_timestamp(el);
	});

});
